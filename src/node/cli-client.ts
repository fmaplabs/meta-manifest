import { execFile } from "node:child_process";
import type { AdminGraphQLClient } from "../sync/client";
import { SyncTransportError } from "../sync/client";
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

/** Strip ANSI escapes, carriage returns, and the CLI's error-box drawing characters. */
function clean(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\r/g, "").replace(/[│╭╮╰╯─]/g, "");
}

/**
 * Pull the first JSON object out of noisy CLI output (progress lines, ANSI
 * codes, error boxes). Returns undefined when nothing parses.
 */
export function extractJsonObject(text: string): unknown | undefined {
  const cleaned = clean(text);
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(cleaned.slice(first, last + 1));
    } catch {
      // fall through to per-line scan
    }
  }
  for (const line of cleaned.split("\n")) {
    if (line.trimStart().startsWith("{")) {
      try {
        return JSON.parse(line);
      } catch {
        // keep scanning
      }
    }
  }
  return undefined;
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
      throw new SyncTransportError(`Failed to run shopify store execute for ${opts.shop}`, cause);
    }
    if (result.code === 0) {
      const parsed = extractJsonObject(result.stdout);
      if (parsed === undefined) {
        throw new SyncTransportError(
          "shopify store execute returned unparseable output",
          result.stdout,
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
    const cleaned = clean(combined);
    if (NO_SESSION_EXACT.test(cleaned) || NO_SESSION_FALLBACK.test(cleaned)) {
      throw new Error(
        `No Shopify CLI session for ${opts.shop}. Run: ${authHint}\n` +
          `If the config declares metafields, append each declared owner resource's read/write scopes (e.g. read_products,write_products).`,
      );
    }
    throw new SyncTransportError(
      `shopify store execute failed (exit ${result.code}). If no session is stored, run: ${authHint}`,
      cleaned.trim().slice(0, 500),
    );
  };
}
