import type { AdminGraphQLClient, AnyEntries, AnyMetafieldSet, DiffOp, EntryOp, MetafieldOp, ScopeConfig } from "@fmaplabs/meta-manifest";
import type { AnySchema } from "@fmaplabs/meta-manifest";
import { planEntriesFor, planFor, planMetafieldsFor } from "./plan";
import { describeEntryOp, describeIssues, describeMetafieldOp, describeOp } from "./format";

export async function runDiff(args: {
  client: AdminGraphQLClient;
  schemas: AnySchema[];
  entries?: AnyEntries[];
  metafields?: AnyMetafieldSet[];
  config?: ScopeConfig;
}): Promise<{ definitions: DiffOp[]; metafields: MetafieldOp[]; entries: EntryOp[] }> {
  const { plan, remote, warnings } = await planFor(args.client, args.schemas, args.config);
  for (const w of warnings) console.warn(`Warning: ${w}`);
  if (plan.length === 0) {
    console.log("Everything is in sync — nothing to apply.");
  } else {
    console.log(`${plan.length} change${plan.length === 1 ? "" : "s"} would be applied:`);
    for (const op of plan) console.log(`  ${describeOp(op)}`);
  }

  let metafieldOps: MetafieldOp[] = [];
  if (args.metafields) {
    // Pulled GID-form ref validations are re-labeled against the managed types' canon.
    const metaobjectTypeById = new Map(remote.map((r) => [r.id, r.type]));
    const metafieldPlan = await planMetafieldsFor(args.client, args.metafields, args.schemas, args.config, {
      metaobjectTypeById,
    });
    for (const w of metafieldPlan.warnings) console.warn(`Warning: ${w}`);
    metafieldOps = metafieldPlan.plan;
    if (metafieldOps.length === 0) {
      console.log("Metafields are in sync — nothing to apply.");
    } else {
      console.log(`${metafieldOps.length} metafield change${metafieldOps.length === 1 ? "" : "s"} would be applied:`);
      for (const op of metafieldOps) console.log(`  ${describeMetafieldOp(op)}`);
    }
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
  return { definitions: plan, metafields: metafieldOps, entries: entryOps };
}
