import { describe, it, expect } from "vitest";
import {
  describeEntryOp,
  describeEntryResult,
  describeIssues,
  describeMetafieldOp,
  describeMetafieldResult,
  describeOp,
  describeResult,
  isDestructive,
  metafieldOpTarget,
  opTarget,
} from "./format";
import type { DiffOp, EntryOp, MetafieldOp } from "../index";

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

  it("metafieldOpTarget renders camelCase owner.namespace.key", () => {
    const op: MetafieldOp = { kind: "createMetafield", ownerType: "PRODUCT", namespace: "$app", key: "careGuide" };
    expect(metafieldOpTarget(op)).toBe("product.$app.careGuide");
    const cl: MetafieldOp = { kind: "createMetafield", ownerType: "COMPANY_LOCATION", namespace: "custom", key: "tier" };
    expect(metafieldOpTarget(cl)).toBe("companyLocation.custom.tier");
  });

  it("describeMetafieldOp lists update changes and marks destructive ops", () => {
    const update: MetafieldOp = { kind: "updateMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a", changes: ["name", "pin"] };
    expect(describeMetafieldOp(update)).toBe("updateMetafield: product.$app.a · name, pin");
    const remove: MetafieldOp = { kind: "removeMetafield", ownerType: "PRODUCT", namespace: "custom", key: "a", destructive: true };
    expect(describeMetafieldOp(remove)).toBe("removeMetafield: product.custom.a · destructive");
  });

  it("describeMetafieldOp warns that app-reserved deletes wipe values store-wide", () => {
    const remove: MetafieldOp = { kind: "removeMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a", destructive: true };
    expect(describeMetafieldOp(remove)).toContain("deletes all stored values store-wide");
    const retype: MetafieldOp = { kind: "changeMetafieldType", ownerType: "PRODUCT", namespace: "$app", key: "a", from: "x", to: "y", destructive: true };
    expect(describeMetafieldOp(retype)).toContain("deletes all stored values store-wide");
  });

  it("describeMetafieldResult uses the same glyphs as definition results", () => {
    const op: MetafieldOp = { kind: "createMetafield", ownerType: "PRODUCT", namespace: "$app", key: "a" };
    expect(describeMetafieldResult({ op, status: "applied", id: "gid://x" })).toContain("✓ applied");
    expect(describeMetafieldResult({ op, status: "skipped", reason: "destructive" })).toContain("– skipped (destructive)");
    expect(describeMetafieldResult({ op, status: "blocked", reason: "dep" })).toContain("⚠ blocked (dep)");
    expect(describeMetafieldResult({ op, status: "failed", userErrors: [{ message: "bad" }] })).toContain("✗ failed (bad)");
  });
});
