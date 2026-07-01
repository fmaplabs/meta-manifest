import { describe, it, expect } from "vitest";
import { describeOp, describeResult, isDestructive, opTarget } from "./format";
import type { DiffOp } from "../index";

const remove: DiffOp = { kind: "removeField", type: "$app:author", key: "legacy", destructive: true };
const add: DiffOp = { kind: "addField", type: "$app:author", field: { key: "bio", type: "multi_line_text_field", required: false, filterable: false, validations: [] } };

describe("format", () => {
  it("opTarget renders type.field for field ops", () => {
    expect(opTarget(add)).toBe("$app:author.bio");
    expect(opTarget(remove)).toBe("$app:author.legacy");
  });
  it("isDestructive + describeOp mark destructive ops", () => {
    expect(isDestructive(remove)).toBe(true);
    expect(describeOp(remove)).toContain("· destructive");
  });
  it("describeResult formats a failed op with its user errors", () => {
    const line = describeResult({ op: add, status: "failed", userErrors: [{ message: "bad" }] });
    expect(line).toContain("✗ failed (bad)");
  });
});
