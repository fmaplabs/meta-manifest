import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInit } from "./init";

describe("runInit", () => {
  it("scaffolds config + schema, and does not overwrite on re-run", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mm-init-"));
    const first = await runInit({ cwd });
    expect(first.created).toContain("meta-manifest.config.ts");
    expect(existsSync(join(cwd, "meta-manifest.config.ts"))).toBe(true);
    expect(readFileSync(join(cwd, "src/schema.ts"), "utf8")).toContain("defineMetaobject");

    const second = await runInit({ cwd });
    expect(second.created).toEqual([]); // nothing overwritten
  });
});
