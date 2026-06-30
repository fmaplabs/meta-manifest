import { expect, test } from "vitest";
import { version } from "./index";

test("package is importable", () => {
  expect(version).toBe("0.0.0");
});
