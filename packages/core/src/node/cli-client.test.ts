import { describe, it, expect } from "vitest";
import {
  buildExecuteArgs,
  createCliAdminClient,
  extractJsonObject,
  CLI_SESSION_SCOPES,
  type RunCommand,
} from "./cli-client";
import { execute, SyncTransportError } from "../sync/client";
import { DEFAULT_API_VERSION } from "../config";
import * as nodeClient from "./client";

it("createCliAdminClient is re-exported from the node client module", () => {
  expect((nodeClient as Record<string, unknown>).createCliAdminClient).toBe(createCliAdminClient);
});

/** Success output as `shopify store execute` prints it: progress noise, ANSI cursor codes, then the unwrapped data object. */
const SUCCESS_STDOUT = `\u001b[2K\u001b[1A\u001b[2K\u001b[GLoading stored store auth ...\r\n{\n  "shop": {\n    "name": "a24 Dev"\n  }\n}\n`;

/** GraphQL error output: standard {"errors":[…]} JSON wrapped in the CLI's ASCII-art box. */
const BOXED_ERRORS_STDERR = [
  "╭─ error ─────────────────────────────────────────────╮",
  "│                                                     │",
  "│  {                                                  │",
  '│    "errors": [                                      │',
  "│      {                                              │",
  '│        "message": "Field does not exist"            │',
  "│      }                                              │",
  "│    ]                                                │",
  "│  }                                                  │",
  "│                                                     │",
  "╰─────────────────────────────────────────────────────╯",
].join("\n");

/** Captured verbatim from CLI 4.8.5 against a store with no stored session (box chars trimmed). */
const NO_SESSION_STDERR = [
  "Loading stored store auth ...",
  "╭─ error ─────────────────────────────────────────────────────────────────────╮",
  "│                                                                             │",
  "│  No stored app authentication found for                                     │",
  "│  s.myshopify.com.                                                           │",
  "│                                                                             │",
  "│  Next steps                                                                 │",
  "│    • Run `shopify store auth --store                                        │",
  "│      s.myshopify.com --scopes                                               │",
  "│      <comma-separated-scopes>` to authenticate                              │",
  "│                                                                             │",
  "╰─────────────────────────────────────────────────────────────────────────────╯",
].join("\n");

const fakeRun =
  (result: { code: number; stdout: string; stderr: string }, calls?: string[][]): RunCommand =>
  async (bin, args) => {
    calls?.push([bin, ...args]);
    return result;
  };

describe("buildExecuteArgs", () => {
  const opts = { shop: "s.myshopify.com" };

  it("builds store execute args with the default API version", () => {
    expect(buildExecuteArgs(opts, "query { shop { name } }")).toEqual([
      "store",
      "execute",
      "--store",
      "s.myshopify.com",
      "--json",
      "--version",
      DEFAULT_API_VERSION,
      "--query",
      "query { shop { name } }",
    ]);
  });

  it("uses an explicit apiVersion when given", () => {
    const args = buildExecuteArgs({ shop: "s.myshopify.com", apiVersion: "2025-10" }, "query { x }");
    expect(args).toContain("2025-10");
    expect(args).not.toContain(DEFAULT_API_VERSION);
  });

  it("appends JSON-stringified variables when given", () => {
    const args = buildExecuteArgs(opts, "query Q($a: Int) { x }", { a: 1 });
    const i = args.indexOf("--variables");
    expect(i).toBeGreaterThan(-1);
    expect(JSON.parse(args[i + 1])).toEqual({ a: 1 });
  });

  it("adds --allow-mutations for mutations, including with leading whitespace", () => {
    expect(buildExecuteArgs(opts, "mutation M { y }")).toContain("--allow-mutations");
    expect(buildExecuteArgs(opts, "  \n mutation M { y }")).toContain("--allow-mutations");
  });

  it("does not add --allow-mutations for queries", () => {
    expect(buildExecuteArgs(opts, "query { x }")).not.toContain("--allow-mutations");
  });
});

/**
 * The CLI's error box wraps long lines (seen in the captured no-session output:
 * `--store` and the shop land on different lines), which puts raw newlines
 * inside JSON string literals once the box chars are stripped.
 */
const WRAPPED_BOXED_ERRORS_STDERR = [
  "╭─ error ─────────────────────────────────────────────╮",
  "│                                                     │",
  "│  {                                                  │",
  '│    "errors": [                                      │',
  "│      {                                              │",
  '│        "message": "Access denied for                │',
  "│          metaobjectDefinitions field. Required      │",
  '│          access: not authorized."                   │',
  "│      }                                              │",
  "│    ]                                                │",
  "│  }                                                  │",
  "│                                                     │",
  "╰─────────────────────────────────────────────────────╯",
].join("\n");

describe("extractJsonObject", () => {
  it("parses a boxed error whose message wraps across lines", () => {
    const parsed = extractJsonObject(WRAPPED_BOXED_ERRORS_STDERR) as { errors: Array<{ message: string }> };
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].message).toContain("Access denied for");
    expect(parsed.errors[0].message).toContain("not authorized");
  });

  it("preserves box-drawing characters inside clean JSON string values", () => {
    const out = `{\n  "name": "Section ── divider │ part"\n}\n`;
    expect(extractJsonObject(out)).toEqual({ name: "Section ── divider │ part" });
  });

  it("parses JSON out of ANSI-noised output", () => {
    expect(extractJsonObject(SUCCESS_STDOUT)).toEqual({ shop: { name: "a24 Dev" } });
  });

  it("parses JSON out of a boxed error block", () => {
    expect(extractJsonObject(BOXED_ERRORS_STDERR)).toEqual({
      errors: [{ message: "Field does not exist" }],
    });
  });

  it("returns undefined for output with no JSON object", () => {
    expect(extractJsonObject("Loading stored store auth ...\nnope")).toBeUndefined();
  });
});

describe("createCliAdminClient", () => {
  const shop = "s.myshopify.com";

  it("returns { data } from a successful run and passes query + variables to the CLI", async () => {
    const calls: string[][] = [];
    const client = createCliAdminClient({
      shop,
      run: fakeRun({ code: 0, stdout: SUCCESS_STDOUT, stderr: "" }, calls),
    });
    const res = await client("query { shop { name } }", { variables: { a: 1 } });
    expect(res).toEqual({ data: { shop: { name: "a24 Dev" } } });
    expect(calls[0][0]).toBe("shopify");
    expect(calls[0]).toContain("--variables");
  });

  it("returns { errors } from a boxed GraphQL error so execute() raises SyncTransportError with the payload", async () => {
    const client = createCliAdminClient({
      shop,
      run: fakeRun({ code: 1, stdout: "", stderr: BOXED_ERRORS_STDERR }),
    });
    const res = await client("query { x }");
    expect(res).toEqual({ errors: [{ message: "Field does not exist" }] });

    const err = await execute(client, "query { x }").then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(SyncTransportError);
    expect((err as SyncTransportError).errors).toEqual([{ message: "Field does not exist" }]);
  });

  it("throws a plain Error with the store auth command when no session is stored", async () => {
    const client = createCliAdminClient({
      shop,
      run: fakeRun({ code: 1, stdout: "", stderr: NO_SESSION_STDERR }),
    });
    const err = await client("query { x }").then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SyncTransportError);
    expect((err as Error).message).toContain(`shopify store auth --store ${shop} --scopes ${CLI_SESSION_SCOPES}`);
  });

  it("routes a wrapped boxed error to { errors }, not a false no-session error", async () => {
    // "not authorized" matches the no-session fallback regex; the parsed
    // errors payload must win over it.
    const client = createCliAdminClient({
      shop,
      run: fakeRun({ code: 1, stdout: "", stderr: WRAPPED_BOXED_ERRORS_STDERR }),
    });
    const res = await client("query { x }");
    expect(res).toHaveProperty("errors");
  });

  it("returns pulled data verbatim when values contain box-drawing characters", async () => {
    const stdout = `Loading stored store auth ...\n{\n  "name": "Section ── divider"\n}\n`;
    const client = createCliAdminClient({ shop, run: fakeRun({ code: 0, stdout, stderr: "" }) });
    const res = await client("query { x }");
    expect(res).toEqual({ data: { name: "Section ── divider" } });
  });

  it("throws a plain Error with the store auth hint and an output excerpt on unrecognized failure output", async () => {
    const client = createCliAdminClient({
      shop,
      run: fakeRun({ code: 1, stdout: "", stderr: "some unrelated explosion" }),
    });
    const err = await client("query { x }").then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    // Not SyncTransportError: the CLI flattens those to a generic "Shopify
    // rejected a request", which would hide the actionable guidance.
    expect(err).not.toBeInstanceOf(SyncTransportError);
    expect((err as Error).message).toContain("shopify store auth");
    expect((err as Error).message).toContain("some unrelated explosion");
  });

  it("throws a plain Error when a zero-exit run prints no parseable JSON", async () => {
    const client = createCliAdminClient({
      shop,
      run: fakeRun({ code: 0, stdout: "all good, no json though", stderr: "" }),
    });
    const err = await client("query { x }").then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SyncTransportError);
    expect((err as Error).message).toContain("all good, no json though");
  });

  it("throws a plain Error mentioning installation when the shopify binary is missing", async () => {
    const enoent: RunCommand = async () => {
      const e = new Error("spawn shopify ENOENT") as Error & { code: string };
      e.code = "ENOENT";
      throw e;
    };
    const client = createCliAdminClient({ shop, run: enoent });
    const err = await client("query { x }").then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SyncTransportError);
    expect((err as Error).message).toMatch(/@shopify\/cli/);
  });
});
