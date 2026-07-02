import type { AdminGraphQLClient, AnyEntries, DiffOp, EntryOp, ScopeConfig } from "../index";
import type { AnySchema } from "../index";
import { planEntriesFor, planFor } from "./plan";
import { describeEntryOp, describeIssues, describeOp } from "./format";

export async function runDiff(args: {
  client: AdminGraphQLClient;
  schemas: AnySchema[];
  entries?: AnyEntries[];
  config?: ScopeConfig;
}): Promise<{ definitions: DiffOp[]; entries: EntryOp[] }> {
  const { plan, warnings } = await planFor(args.client, args.schemas, args.config);
  for (const w of warnings) console.warn(`Warning: ${w}`);
  if (plan.length === 0) {
    console.log("Everything is in sync — nothing to apply.");
  } else {
    console.log(`${plan.length} change${plan.length === 1 ? "" : "s"} would be applied:`);
    for (const op of plan) console.log(`  ${describeOp(op)}`);
  }

  let entryOps: EntryOp[] = [];
  if (args.entries) {
    // Types whose definition is still pending creation can't be pulled — their
    // entries are creates by construction.
    const pendingCreateTypes = new Set(plan.filter((op) => op.kind === "createDefinition").map((op) => op.type));
    const entryPlan = await planEntriesFor(args.client, args.entries, args.schemas, args.config, { pendingCreateTypes });
    if (entryPlan.issues.length > 0) {
      throw new Error(`Entry validation failed:\n${describeIssues(entryPlan.issues)}`);
    }
    entryOps = entryPlan.plan;
    if (entryOps.length === 0) {
      console.log("Entries are in sync — nothing to apply.");
    } else {
      console.log(`${entryOps.length} entry change${entryOps.length === 1 ? "" : "s"} would be applied:`);
      for (const op of entryOps) console.log(`  ${describeEntryOp(op)}`);
    }
  }
  return { definitions: plan, entries: entryOps };
}
