import type { AdminGraphQLClient, DiffOp, ScopeConfig } from "../index";
import type { AnySchema } from "../index";
import { planFor } from "./plan";
import { describeOp } from "./format";

export async function runDiff(args: {
  client: AdminGraphQLClient;
  schemas: AnySchema[];
  config?: ScopeConfig;
}): Promise<DiffOp[]> {
  const { plan, warnings } = await planFor(args.client, args.schemas, args.config);
  for (const w of warnings) console.warn(`Warning: ${w}`);
  if (plan.length === 0) {
    console.log("Everything is in sync — nothing to apply.");
  } else {
    console.log(`${plan.length} change${plan.length === 1 ? "" : "s"} would be applied:`);
    for (const op of plan) console.log(`  ${describeOp(op)}`);
  }
  return plan;
}
