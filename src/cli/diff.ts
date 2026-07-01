import type { AdminGraphQLClient, DiffOp } from "../index";
import type { AnySchema } from "../index";
import { planFor } from "./plan";
import { describeOp } from "./format";

export async function runDiff(args: { client: AdminGraphQLClient; schemas: AnySchema[] }): Promise<DiffOp[]> {
  const { plan } = await planFor(args.client, args.schemas);
  if (plan.length === 0) {
    console.log("Everything is in sync — nothing to apply.");
  } else {
    console.log(`${plan.length} change${plan.length === 1 ? "" : "s"} would be applied:`);
    for (const op of plan) console.log(`  ${describeOp(op)}`);
  }
  return plan;
}
