import { describe, it, expect, vi, afterEach } from "vitest";
import { SyncTransportError } from "@fmaplabs/meta-manifest";
import { checkExitCode, describeTransportError, main, parseArgs } from "./index";

afterEach(() => vi.restoreAllMocks());

describe("parseArgs", () => {
  it("parses command and flags", () => {
    expect(parseArgs(["push", "--allow-destructive"])).toMatchObject({ command: "push", allowDestructive: true });
    expect(parseArgs(["pull", "--force"])).toMatchObject({ command: "pull", force: true });
    expect(parseArgs(["diff", "--config", "custom.ts"])).toMatchObject({ command: "diff", config: "custom.ts" });
    expect(parseArgs(["--help"])).toMatchObject({ help: true });
  });

  it("parses --allow-cli-app-scope and defaults it to false", () => {
    expect(parseArgs(["push", "--allow-cli-app-scope"])).toMatchObject({ command: "push", allowCliAppScope: true });
    expect(parseArgs(["push"])).toMatchObject({ allowCliAppScope: false });
  });

  it('parses --scope and defaults it to "app"', () => {
    expect(parseArgs(["pull", "--scope", "merchant"])).toMatchObject({ command: "pull", scope: "merchant" });
    expect(parseArgs(["pull", "--scope", "all"])).toMatchObject({ command: "pull", scope: "all" });
    expect(parseArgs(["pull"])).toMatchObject({ scope: "app" });
  });

  it("rejects an unknown --scope value", () => {
    expect(() => parseArgs(["pull", "--scope", "everything"])).toThrow(/--scope/);
  });

  it("parses --flag=value forms", () => {
    expect(parseArgs(["pull", "--scope=merchant"])).toMatchObject({ command: "pull", scope: "merchant" });
    expect(parseArgs(["diff", "--config=custom.ts"])).toMatchObject({ command: "diff", config: "custom.ts" });
  });

  it("rejects an unknown --scope value in equals form", () => {
    expect(() => parseArgs(["pull", "--scope=everything"])).toThrow(/--scope/);
    expect(() => parseArgs(["pull", "--scope="])).toThrow(/--scope/);
  });

  it("rejects a value attached to a boolean flag", () => {
    expect(() => parseArgs(["pull", "--force=true"])).toThrow(/--force/);
  });

  it("rejects unknown flags instead of silently ignoring them", () => {
    expect(() => parseArgs(["pull", "--scpoe=merchant"])).toThrow(/--scpoe/);
    expect(() => parseArgs(["pull", "--unknown"])).toThrow(/--unknown/);
  });

  it("parses --check and defaults it to false", () => {
    expect(parseArgs(["diff", "--check"])).toMatchObject({ command: "diff", check: true });
    expect(parseArgs(["diff"])).toMatchObject({ check: false });
  });

  it("rejects a value attached to --check", () => {
    expect(() => parseArgs(["diff", "--check=x"])).toThrow(/--check/);
  });
});

describe("describeTransportError", () => {
  it("names the failure and surfaces the response body", () => {
    const err = new SyncTransportError("Client-credentials token request returned HTTP 400", '{"error":"shop_not_permitted"}');
    const out = describeTransportError(err);
    expect(out).toContain("Client-credentials token request returned HTTP 400");
    expect(out).toContain("shop_not_permitted");
  });

  it("stringifies a structured errors payload and omits an absent one", () => {
    const structured = describeTransportError(new SyncTransportError("Admin API returned HTTP 200", [{ message: "boom" }]));
    expect(structured).toContain("boom");
    const bare = describeTransportError(new SyncTransportError("Request to s.myshopify.com failed", null));
    expect(bare).toBe("Sync failed: Request to s.myshopify.com failed.");
  });
});

describe("HELP", () => {
  it("mentions the .env scaffold in the init command line", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--help"]);
    const help = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(help).toMatch(/init.*\.env/);
  });
});

describe("checkExitCode", () => {
  const op = {} as never;

  it("returns 0 when every op list is empty", () => {
    expect(checkExitCode({ definitions: [], metafields: [], entries: [] })).toBe(0);
  });

  it("returns 2 on drift in any of the three lists", () => {
    expect(checkExitCode({ definitions: [op], metafields: [], entries: [] })).toBe(2);
    expect(checkExitCode({ definitions: [], metafields: [op], entries: [] })).toBe(2);
    expect(checkExitCode({ definitions: [], metafields: [], entries: [op] })).toBe(2);
  });
});
