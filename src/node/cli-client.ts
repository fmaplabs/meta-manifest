import { execFile } from "node:child_process";
import type { AdminGraphQLClient } from "../sync/client";
import { DEFAULT_API_VERSION } from "../config";

/**
 * Runs a binary and resolves `{ code, stdout, stderr }` uniformly — a non-zero
 * exit is a result, not a rejection. Injectable so tests exercise the client
 * without spawning the real Shopify CLI.
 */
export type RunCommand = (
  bin: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Scopes a `shopify store auth` session needs for metaobject sync (metafields additionally need each declared owner resource's read/write scopes). */
export const CLI_SESSION_SCOPES =
  "read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects";

/** Build the `shopify store execute` argv for one GraphQL operation. */
export function buildExecuteArgs(
  opts: { shop: string; apiVersion?: string },
  query: string,
  variables?: Record<string, unknown>,
): string[] {
  const args = [
    "store",
    "execute",
    "--store",
    opts.shop,
    "--json",
    "--version",
    opts.apiVersion ?? DEFAULT_API_VERSION,
    "--query",
    query,
  ];
  if (variables !== undefined) args.push("--variables", JSON.stringify(variables));
  // The CLI refuses mutations without the flag; passing it only for mutations
  // preserves that safety default for pull/diff.
  if (/^\s*mutation\b/.test(query)) args.push("--allow-mutations");
  return args;
}

/** Strip ANSI escapes and carriage returns. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

/** Additionally strip the CLI's error-box drawing characters. */
function stripBox(text: string): string {
  return stripAnsi(text).replace(/[│╭╮╰╯─]/g, "");
}

function parseBraceSlice(text: string): unknown | undefined {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last <= first) return undefined;
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return undefined;
  }
}

/**
 * Pull the first JSON object out of noisy CLI output (progress lines, ANSI
 * codes, error boxes). Attempts, in order: the raw braced slice (so clean JSON
 * keeps any box-drawing characters inside its string values); each line that
 * is itself an object; the slice with box chars stripped; and finally that
 * slice with wrapped lines rejoined — the error box wraps long lines, which
 * leaves raw newlines inside JSON string literals. Returns undefined when
 * nothing parses.
 */
export function extractJsonObject(text: string): unknown | undefined {
  const base = stripAnsi(text);
  const direct = parseBraceSlice(base);
  if (direct !== undefined) return direct;
  for (const line of base.split("\n")) {
    if (line.trimStart().startsWith("{")) {
      try {
        return JSON.parse(line);
      } catch {
        // keep scanning
      }
    }
  }
  const unboxed = stripBox(base);
  return parseBraceSlice(unboxed) ?? parseBraceSlice(unboxed.replace(/\s*\n\s*/g, " "));
}

const defaultRun: RunCommand = (bin, args) =>
  new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      // No piped stdin: the CLI must fail fast instead of waiting on a prompt.
      { env: { ...process.env, SHOPIFY_FLAG_NO_COLOR: "1" }, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // execFile's error.code is the numeric exit code for a non-zero exit,
        // or a string like "ENOENT" when the binary could not be spawned.
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (error && typeof code !== "number") return reject(error);
        resolve({ code: typeof code === "number" ? code : 0, stdout, stderr });
      },
    );
  });

const NO_SESSION_EXACT = /No stored app authentication found/i;
const NO_SESSION_FALLBACK = /no.*(session|auth)|not logged in|log ?in|session.*expired/i;

/**
 * Build an AdminGraphQLClient that shells out to `shopify store execute`,
 * authenticating via the Shopify CLI's stored `shopify store auth` session
 * instead of an Admin API token. Expect ~2–4 s of process overhead per call.
 *
 * Caveat: under CLI auth, `$app`-scoped material resolves to the *Shopify
 * CLI's* app identity, not your app's — the `mm` CLI guards against this.
 */
export function createCliAdminClient(opts: {
  shop: string;
  apiVersion?: string;
  run?: RunCommand;
}): AdminGraphQLClient {
  const run = opts.run ?? defaultRun;
  const authHint = `shopify store auth --store ${opts.shop} --scopes ${CLI_SESSION_SCOPES}`;
  return async (query, options) => {
    let result: { code: number; stdout: string; stderr: string };
    try {
      result = await run("shopify", buildExecuteArgs(opts, query, options?.variables));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") {
        throw new Error(
          `Shopify CLI not found. Install it (e.g. \`pnpm add -D @shopify/cli\`) or remove \`auth: "cli"\` from the config.`,
        );
      }
      // Plain Errors throughout the local-failure paths: the CLI flattens
      // SyncTransportError to a generic "Shopify rejected a request", which
      // would mislabel a local failure and hide the guidance.
      throw new Error(
        `Failed to run shopify store execute for ${opts.shop}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (result.code === 0) {
      const parsed = extractJsonObject(result.stdout);
      if (parsed === undefined) {
        throw new Error(
          `shopify store execute returned unparseable output for ${opts.shop}:\n${stripAnsi(result.stdout).trim().slice(0, 500)}`,
        );
      }
      // Success output is the data object unwrapped (no {"data":…} envelope).
      return { data: parsed };
    }
    const combined = `${result.stdout}\n${result.stderr}`;
    const parsed = extractJsonObject(combined);
    if (parsed !== null && typeof parsed === "object" && "errors" in (parsed as object)) {
      // Same payload shape as the token client, so execute()'s error path and
      // fetchScopeHandles' silent degrade behave identically under CLI auth.
      return { errors: (parsed as { errors: unknown }).errors };
    }
    const cleaned = stripBox(combined);
    if (NO_SESSION_EXACT.test(cleaned) || NO_SESSION_FALLBACK.test(cleaned)) {
      throw new Error(
        `No Shopify CLI session for ${opts.shop}. Run: ${authHint}\n` +
          `If the config declares metafields, append each declared owner resource's read/write scopes (e.g. read_products,write_products).`,
      );
    }
    throw new Error(
      `shopify store execute failed (exit ${result.code}). If no session is stored, run: ${authHint}\n` +
        `Output: ${cleaned.trim().slice(0, 500)}`,
    );
  };
}
