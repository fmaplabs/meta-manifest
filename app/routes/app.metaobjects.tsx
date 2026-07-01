import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  diff,
  normalizeLocal,
  normalizeRemote,
  pull,
  push,
  SyncTransportError,
  type AdminGraphQLClient,
  type DiffOp,
  type PushOpResult,
  type PushResult,
} from "@meta-manifest/core";

import { authenticate } from "../shopify.server";
import { Material, Product, schemas } from "../metaobjects/schema";

// --- shared sync plumbing -------------------------------------------------

const types = schemas.map((s) => s.type);
// normalizeLocal is generic and can't be mapped over the mixed schema array —
// call it per schema. (.type / .toDefinitionInput() are methods and map fine.)
const localDefs = [normalizeLocal(Material), normalizeLocal(Product)];
const definitions = schemas.map((s) => s.toDefinitionInput());

/** The Admin API context returned by `authenticate.admin(request)`. */
type Admin = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

/**
 * Adapt the authenticated Admin client into the transport the sync adapter wants:
 * `admin.graphql` resolves to a `Response`, so `.json()` yields `{ data, errors }`.
 */
function makeClient(admin: Admin): AdminGraphQLClient {
  return (query, options) => admin.graphql(query, options).then((r) => r.json());
}

async function planFor(client: AdminGraphQLClient) {
  const remote = await pull(client, types);
  const plan = diff(localDefs, remote.map((r) => normalizeRemote(r.definition)));
  return { plan, remote };
}

// --- loader: preview the pending changes (read-only) ----------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  try {
    const { plan } = await planFor(makeClient(admin));
    return { plan, error: null as string | null };
  } catch (err) {
    const message =
      err instanceof SyncTransportError
        ? "Couldn't read metaobject definitions from Shopify."
        : `Unexpected error: ${String(err)}`;
    return { plan: [] as DiffOp[], error: message };
  }
};

// --- action: pull → diff → push ------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const allowDestructive = formData.get("allowDestructive") === "on";

  const client = makeClient(admin);
  try {
    const { plan, remote } = await planFor(client);
    const result = await push(client, plan, { definitions, remote }, { allowDestructive });
    return { result, error: null as string | null };
  } catch (err) {
    const message =
      err instanceof SyncTransportError
        ? "Sync failed: Shopify rejected a request."
        : `Unexpected error: ${String(err)}`;
    return { result: null as PushResult | null, error: message };
  }
};

// --- presentation helpers -------------------------------------------------

function opTarget(op: DiffOp): string {
  if (op.kind === "addField") return `${op.type}.${op.field.key}`;
  if ("key" in op) return `${op.type}.${op.key}`;
  return op.type;
}

function isDestructive(op: DiffOp): boolean {
  return "destructive" in op && op.destructive === true;
}

function describeOp(op: DiffOp): string {
  return `${op.kind}: ${opTarget(op)}${isDestructive(op) ? " · destructive" : ""}`;
}

function describeResult(r: PushOpResult): string {
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

// --- page -----------------------------------------------------------------

export default function MetaobjectsPage() {
  const { plan, error: loadError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const isSyncing =
    ["loading", "submitting"].includes(fetcher.state) && fetcher.formMethod === "POST";
  const result = fetcher.data?.result ?? null;
  const actionError = fetcher.data?.error ?? null;
  const hasDestructive = plan.some(isDestructive);

  useEffect(() => {
    if (result) {
      shopify.toast.show(result.ok ? "Definitions synced" : "Sync finished with issues");
    }
  }, [result, shopify]);

  const sync = (allowDestructive: boolean) =>
    fetcher.submit({ allowDestructive: allowDestructive ? "on" : "" }, { method: "POST" });

  return (
    <s-page heading="Metaobject definitions">
      <s-button
        slot="primary-action"
        onClick={() => sync(false)}
        {...(isSyncing ? { loading: true } : {})}
      >
        Sync to Shopify
      </s-button>

      <s-section heading="Pending changes">
        {loadError ? (
          <s-paragraph>{loadError}</s-paragraph>
        ) : plan.length === 0 ? (
          <s-paragraph>Everything is in sync — nothing to apply.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {plan.length} change{plan.length === 1 ? "" : "s"} would be applied on the next
              sync:
            </s-paragraph>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="small-100">
                {plan.map((op, i) => (
                  <s-text key={i}>{describeOp(op)}</s-text>
                ))}
              </s-stack>
            </s-box>
          </s-stack>
        )}
      </s-section>

      {hasDestructive && (
        <s-section heading="Destructive changes">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              This plan removes or retypes fields, which can delete stored data. Destructive
              ops are skipped by a normal sync — apply them only if you're sure.
            </s-paragraph>
            <s-button
              onClick={() => sync(true)}
              {...(isSyncing ? { loading: true } : {})}
            >
              Sync including destructive changes
            </s-button>
          </s-stack>
        </s-section>
      )}

      {actionError && (
        <s-section heading="Error">
          <s-paragraph>{actionError}</s-paragraph>
        </s-section>
      )}

      {result && (
        <s-section heading="Last sync result">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              applied {result.counts.applied} · skipped {result.counts.skipped} · blocked{" "}
              {result.counts.blocked} · failed {result.counts.failed}
              {result.ok ? " — all good" : " — needs attention"}
            </s-paragraph>
            <s-box
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="block" gap="small-100">
                {result.results.map((r, i) => (
                  <s-text key={i}>{describeResult(r)}</s-text>
                ))}
              </s-stack>
            </s-box>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
