import type { AdminGraphQLClient, DiffOp, PulledRemote } from "../index";
import { diff, normalizeLocal, normalizeRemote, pull } from "../index";
import type { AnySchema } from "../index";

/** Pull the schemas' types, normalize, and diff local↔remote. */
export async function planFor(
  client: AdminGraphQLClient,
  schemas: AnySchema[],
): Promise<{ plan: DiffOp[]; remote: PulledRemote[] }> {
  const types = schemas.map((s) => s.type);
  const localDefs = schemas.map(normalizeLocal);
  const remote = await pull(client, types);
  const plan = diff(localDefs, remote.map((r) => normalizeRemote(r.definition)));
  return { plan, remote };
}
