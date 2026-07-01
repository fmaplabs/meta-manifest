import type { AdminGraphQLClient, PushResult } from "../index";
import type { AnySchema } from "../index";
import { push } from "../index";
import { planFor } from "./plan";
import { describeResult, isDestructive } from "./format";

export async function runPush(args: {
  client: AdminGraphQLClient;
  schemas: AnySchema[];
  allowDestructive?: boolean;
}): Promise<PushResult> {
  const { plan, remote } = await planFor(args.client, args.schemas);
  const definitions = args.schemas.map((s) => s.toDefinitionInput());
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
