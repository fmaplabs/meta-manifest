import type { AdminGraphQLClient, PushResult, ScopeConfig } from "../index";
import type { AnySchema } from "../index";
import { push } from "../index";
import { planFor } from "./plan";
import { describeResult, isDestructive } from "./format";

export async function runPush(args: {
  client: AdminGraphQLClient;
  schemas: AnySchema[];
  config?: ScopeConfig;
  allowDestructive?: boolean;
}): Promise<PushResult> {
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
  return result;
}
