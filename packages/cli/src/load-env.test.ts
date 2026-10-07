import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDotEnv } from "./load-env";

const VARS = ["MM_TEST_FROM_FILE", "MM_TEST_PRECEDENCE"];

function dirWithEnv(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mm-env-"));
  writeFileSync(join(dir, ".env"), contents);
  return dir;
}

describe("loadDotEnv", () => {
  afterEach(() => {
    for (const v of VARS) delete process.env[v];
  });

  it("loads variables from .env in the given directory", () => {
    const dir = dirWithEnv("MM_TEST_FROM_FILE=hello\n");
    loadDotEnv(dir);
    expect(process.env.MM_TEST_FROM_FILE).toBe("hello");
  });

  it("is a no-op when no .env file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-env-none-"));
    expect(() => loadDotEnv(dir)).not.toThrow();
  });

  it("does not overwrite a variable already set in the environment", () => {
    process.env.MM_TEST_PRECEDENCE = "from_env";
    const dir = dirWithEnv("MM_TEST_PRECEDENCE=from_file\n");
    loadDotEnv(dir);
    expect(process.env.MM_TEST_PRECEDENCE).toBe("from_env");
  });
});
