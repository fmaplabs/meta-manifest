import { describe, it, expect } from "vitest";
import { parseArgs } from "./index";

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
});
