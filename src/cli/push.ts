import type { AdminGraphQLClient, AnyEntries, EntryPushResult, PushResult, ScopeConfig } from "../index";
import type { AnySchema } from "../index";
import { push, pushEntries, resolveEntries } from "../index";
import { planEntriesFor, planFor } from "./plan";
import { describeEntryResult, describeIssues, describeResult, isDestructive } from "./format";

export interface RunPushResult {
  definitions: PushResult;
  entries?: EntryPushResult;
  ok: boolean;
}

export async function runPush(args: {
  client: AdminGraphQLClient;
  schemas: AnySchema[];
  entries?: AnyEntries[];
  config?: ScopeConfig;
  allowDestructive?: boolean;
}): Promise<RunPushResult> {
  // Entry validation runs first: a bad declaration fails fast, before any
  // network call touches definitions.
  if (args.entries) {
    const { issues } = resolveEntries(args.entries, args.schemas, args.config);
    if (issues.length > 0) throw new Error(`Entry validation failed:\n${describeIssues(issues)}`);
  }

  const { plan, remote, definitions, warnings } = await planFor(args.client, args.schemas, args.config);
  for (const w of warnings) console.warn(`Warning: ${w}`);
  const result = await push(args.client, plan, { definitions, remote }, { allowDestructive: args.allowDestructive });

  for (const r of result.results) console.log(`  ${describeResult(r)}`);
  console.log(
    `applied ${result.counts.applied} · skipped ${result.counts.skipped} · ` +
      `blocked ${result.counts.blocked} · failed ${result.counts.failed}`,
  );
  if (!args.allowDestructive && plan.some(isDestructive)) {
    console.log("Some destructive changes were skipped. Re-run with --allow-destructive to apply them.");
  }

  let entriesResult: EntryPushResult | undefined;
  if (args.entries) {
    // Entry planning runs after the definitions push so just-created definitions
    // exist. Types whose create failed or blocked gate their entry ops.
    const failedDefinitionTypes = new Set(
      result.results
        .filter((r) => r.op.kind === "createDefinition" && r.status !== "applied")
        .map((r) => r.op.type),
    );
    const entryPlan = await planEntriesFor(args.client, args.entries, args.schemas, args.config, {
      pendingCreateTypes: failedDefinitionTypes,
    });
    entriesResult = await pushEntries(args.client, entryPlan.plan, {
      entries: entryPlan.entries,
      remote: entryPlan.remote,
      failedDefinitionTypes,
    });
    for (const r of entriesResult.results) console.log(`  ${describeEntryResult(r)}`);
    console.log(
      `entries: applied ${entriesResult.counts.applied} · ` +
        `blocked ${entriesResult.counts.blocked} · failed ${entriesResult.counts.failed}`,
    );
  }

  return { definitions: result, entries: entriesResult, ok: result.ok && (entriesResult?.ok ?? true) };
}
