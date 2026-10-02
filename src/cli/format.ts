import type {
  DiffOp,
  EntryOp,
  EntryPushOpResult,
  Issue,
  MetafieldOp,
  MetafieldPushOpResult,
  PushOpResult,
} from "../index";
import { isAppReservedNamespace, metafieldOwnerKey } from "../metafields";

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

/** `product.$app.careGuide`-style identifier: camelCase owner, namespace, key. */
export function metafieldOpTarget(op: MetafieldOp): string {
  const owner = metafieldOwnerKey(op.ownerType) ?? op.ownerType;
  return `${owner}.${op.namespace}.${op.key}`;
}

export function isDestructiveMetafield(op: MetafieldOp): boolean {
  return "destructive" in op && op.destructive === true;
}

export function describeMetafieldOp(op: MetafieldOp): string {
  const head = `${op.kind}: ${metafieldOpTarget(op)}`;
  const changes = op.kind === "updateMetafield" && op.changes.length ? ` · ${op.changes.join(", ")}` : "";
  if (!isDestructiveMetafield(op)) return `${head}${changes}`;
  // Deleting inside an app-reserved namespace wipes every stored value, async. [design §6]
  const wipes = isAppReservedNamespace(op.namespace) ? " (deletes all stored values store-wide)" : "";
  return `${head}${changes} · destructive${wipes}`;
}

export function describeMetafieldResult(r: MetafieldPushOpResult): string {
  const head = `${r.op.kind}: ${metafieldOpTarget(r.op)}`;
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
