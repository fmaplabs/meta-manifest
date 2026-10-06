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
});
