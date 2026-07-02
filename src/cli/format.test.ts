import { describe, it, expect } from "vitest";
import { describeEntryOp, describeEntryResult, describeIssues, describeOp, describeResult, isDestructive, opTarget } from "./format";
import type { DiffOp, EntryOp } from "../index";

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

  it("describeEntryOp renders type/handle plus the changed fields and status", () => {
    const create: EntryOp = { kind: "createEntry", type: "$app:author", handle: "jane-austen" };
    const update: EntryOp = { kind: "updateEntry", type: "$app:author", handle: "jane-austen", changes: ["name"], statusChange: true };
    expect(describeEntryOp(create)).toBe("createEntry: $app:author/jane-austen");
    expect(describeEntryOp(update)).toBe("updateEntry: $app:author/jane-austen · name, status");
  });

  it("describeEntryResult uses the same glyphs as definition results", () => {
    const op: EntryOp = { kind: "createEntry", type: "$app:author", handle: "jane" };
    expect(describeEntryResult({ op, status: "applied", id: "gid://x" })).toContain("✓ applied");
    expect(describeEntryResult({ op, status: "blocked", reason: "dep" })).toContain("⚠ blocked (dep)");
    expect(describeEntryResult({ op, status: "failed", userErrors: [{ message: "bad" }] })).toContain("✗ failed (bad)");
  });

  it("describeIssues renders one line per issue", () => {
    expect(describeIssues([{ message: "a" }, { message: "b" }])).toBe("  ✗ a\n  ✗ b");
  });
});
