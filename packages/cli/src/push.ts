import type {
  AdminGraphQLClient,
  AnyEntries,
  AnyMetafieldSet,
  EntryPushResult,
  MetafieldPushResult,
  PushResult,
  ScopeConfig,
} from "@fmaplabs/meta-manifest";
import type { AnySchema } from "@fmaplabs/meta-manifest";
import { push, pushEntries, pushMetafields, resolveEntries } from "@fmaplabs/meta-manifest";
import { planEntriesFor, planFor, planMetafieldsFor } from "./plan";
import {
  describeEntryResult,
  describeIssues,
  describeMetafieldResult,
  describeResult,
  isDestructive,
  isDestructiveMetafield,
} from "./format";

export interface RunPushResult {
  definitions: PushResult;
  metafields?: MetafieldPushResult;
  entries?: EntryPushResult;
  ok: boolean;
}

export async function runPush(args: {
  client: AdminGraphQLClient;
  schemas: AnySchema[];
  entries?: AnyEntries[];
  metafields?: AnyMetafieldSet[];
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

  let destructiveSkipped = !args.allowDestructive && plan.some(isDestructive);

  // Types whose create did not apply gate the metafield ops that reference them
  // and the entry ops that live under them.
  const failedDefinitionTypes = new Set(
    result.results
      .filter((r) => r.op.kind === "createDefinition" && r.status !== "applied")
      .map((r) => r.op.type),
  );

  // Metafield definitions push after metaobject creates (a metaobject_reference
  // metafield needs its target definition) and before entries. [design §2.7]
  let metafieldsResult: MetafieldPushResult | undefined;
  if (args.metafields) {
    // Metaobject ids: pulled ones plus those created this run, for ref-target
    // GID rewriting both ways (pulled validations → type canon, payloads → GIDs).
    const metaobjectTypeById = new Map(remote.map((r) => [r.id, r.type]));
    const metaobjectIdsByType = new Map(remote.map((r) => [r.type, r.id]));
    for (const r of result.results) {
      if (r.op.kind === "createDefinition" && r.status === "applied" && r.id) {
        metaobjectTypeById.set(r.id, r.op.type);
        metaobjectIdsByType.set(r.op.type, r.id);
      }
    }
    const metafieldPlan = await planMetafieldsFor(args.client, args.metafields, args.schemas, args.config, {
      metaobjectTypeById,
    });
    for (const w of metafieldPlan.warnings) console.warn(`Warning: ${w}`);
    metafieldsResult = await pushMetafields(
      args.client,
      metafieldPlan.plan,
      {
        definitions: metafieldPlan.definitions,
        remote: metafieldPlan.remote,
        metaobjectIdsByType,
        failedMetaobjectTypes: failedDefinitionTypes,
      },
      { allowDestructive: args.allowDestructive },
    );
    for (const r of metafieldsResult.results) console.log(`  ${describeMetafieldResult(r)}`);
    console.log(
      `metafields: applied ${metafieldsResult.counts.applied} · skipped ${metafieldsResult.counts.skipped} · ` +
        `blocked ${metafieldsResult.counts.blocked} · failed ${metafieldsResult.counts.failed}`,
    );
    destructiveSkipped ||= !args.allowDestructive && metafieldPlan.plan.some(isDestructiveMetafield);
  }

  if (destructiveSkipped) {
    console.log("Some destructive changes were skipped. Re-run with --allow-destructive to apply them.");
  }

  let entriesResult: EntryPushResult | undefined;
  if (args.entries) {
    // Entry planning runs after the definitions push so just-created definitions exist.
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

  return {
    definitions: result,
    metafields: metafieldsResult,
    entries: entriesResult,
    ok: result.ok && (metafieldsResult?.ok ?? true) && (entriesResult?.ok ?? true),
  };
}
