import type { DiffOp, EntryOp, EntryPushOpResult, Issue, PushOpResult } from "../index";

export function opTarget(op: DiffOp): string {
  if (op.kind === "addField") return `${op.type}.${op.field.key}`;
  if ("key" in op) return `${op.type}.${op.key}`;
  return op.type;
}

export function isDestructive(op: DiffOp): boolean {
  return "destructive" in op && op.destructive === true;
}

export function describeOp(op: DiffOp): string {
  return `${op.kind}: ${opTarget(op)}${isDestructive(op) ? " · destructive" : ""}`;
}

export function describeResult(r: PushOpResult): string {
  const head = `${r.op.kind}: ${opTarget(r.op)}`;
  switch (r.status) {
    case "applied":
      return `✓ applied — ${head}`;
    case "skipped":
      return `– skipped (${r.reason}) — ${head}`;
    case "blocked":
      return `⚠ blocked (${r.reason}) — ${head}`;
    case "failed":
      return `✗ failed (${r.userErrors.map((e) => e.message).join("; ")}) — ${head}`;
  }
}

export function describeEntryOp(op: EntryOp): string {
  const target = `${op.type}/${op.handle}`;
  if (op.kind === "updateEntry") {
    const what = [...op.changes, ...(op.statusChange ? ["status"] : [])];
    return `updateEntry: ${target} · ${what.join(", ")}`;
  }
  return `createEntry: ${target}`;
}

export function describeEntryResult(r: EntryPushOpResult): string {
  const head = describeEntryOp(r.op);
  switch (r.status) {
    case "applied":
      return `✓ applied — ${head}`;
    case "blocked":
      return `⚠ blocked (${r.reason}) — ${head}`;
    case "failed":
      return `✗ failed (${r.userErrors.map((e) => e.message).join("; ")}) — ${head}`;
  }
}

export function describeIssues(issues: Issue[]): string {
  return issues.map((i) => `  ✗ ${i.message}`).join("\n");
}
