import { describe, expect, it } from "vitest";
import type { MetaobjectDefinitionInput } from "../definition-input";
import { defineMetaobject } from "../define";
import { m } from "../fields/index";
import { CREATE_DEFINITION_MUTATION, UPDATE_DEFINITION_MUTATION, type AdminGraphQLClient } from "./client";
import type { DiffOp } from "./diff";
import { normalizeLocal } from "./normalize";
import type { PulledRemote } from "./pull";
import { push, referenceEdges } from "./push";

type UserError = { field?: string[]; message: string; code?: string };
interface Call {
  query: string;
  variables: Record<string, unknown> | undefined;
}
interface FakeConfig {
  createId?: string;
  createUserErrors?: UserError[];
  updateUserErrors?: UserError[];
  throwOnCall?: boolean;
}

function recordingClient(config: FakeConfig = {}) {
  const calls: Call[] = [];
  const client: AdminGraphQLClient = async (query, options) => {
    calls.push({ query, variables: options?.variables });
    if (config.throwOnCall) throw new Error("network down");
    if (query === CREATE_DEFINITION_MUTATION) {
      return {
        data: {
          metaobjectDefinitionCreate: {
            metaobjectDefinition: { id: config.createId ?? "gid://shopify/MetaobjectDefinition/created", type: "app--999--x" },
            userErrors: config.createUserErrors ?? [],
          },
        },
      };
    }
    if (query === UPDATE_DEFINITION_MUTATION) {
      return {
        data: {
          metaobjectDefinitionUpdate: {
            metaobjectDefinition: { id: options?.variables?.id as string, type: "app--999--x" },
            userErrors: config.updateUserErrors ?? [],
          },
        },
      };
    }
    return { data: {} };
  };
  return { client, calls };
}

const Author = defineMetaobject("author", {
  name: "Author",
  fields: { name: m.text({ required: true, max: 120 }), bio: m.multilineText() },
});
const authorDef = Author.toDefinitionInput();
const authorRemote: PulledRemote = {
  id: "gid://shopify/MetaobjectDefinition/author-1",
  type: "$app:author",
  definition: { type: "$app:author", name: "Author", fieldDefinitions: [] },
};

describe("push — op application", () => {
  it("createDefinition sends the full definition input and reports applied", async () => {
    const { client, calls } = recordingClient({ createId: "gid://shopify/MetaobjectDefinition/new-author" });
    const plan: DiffOp[] = [{ kind: "createDefinition", type: "$app:author", definition: normalizeLocal(Author) }];
    const result = await push(client, plan, { definitions: [authorDef], remote: [] });

    expect(calls).toEqual([{ query: CREATE_DEFINITION_MUTATION, variables: { definition: authorDef } }]);
    expect(result.results).toEqual([{ op: plan[0], status: "applied", id: "gid://shopify/MetaobjectDefinition/new-author" }]);
    expect(result.ok).toBe(true);
  });

  it("addField updates the definition with the full create field input", async () => {
    const { client, calls } = recordingClient();
    const bio = normalizeLocal(Author).fields[1]!;
    const plan: DiffOp[] = [{ kind: "addField", type: "$app:author", field: bio }];
    const result = await push(client, plan, { definitions: [authorDef], remote: [authorRemote] });

    expect(calls).toEqual([
      {
        query: UPDATE_DEFINITION_MUTATION,
        variables: {
          id: "gid://shopify/MetaobjectDefinition/author-1",
          definition: { fieldDefinitions: [{ create: { key: "bio", name: "bio", required: false, type: "multi_line_text_field", validations: [] } }] },
        },
      },
    ]);
    expect(result.results).toEqual([{ op: plan[0], status: "applied", id: "gid://shopify/MetaobjectDefinition/author-1" }]);
  });

  it("updateField sends the full field input (sourced from definitions, not op.changes) without the immutable type", async () => {
    const { client, calls } = recordingClient();
    // op.changes says required:false, but the local definition says required:true —
    // push must send the definition's truth, not the lossy plan delta. [design §7]
    const plan: DiffOp[] = [{ kind: "updateField", type: "$app:author", key: "name", changes: { required: false } }];
    await push(client, plan, { definitions: [authorDef], remote: [authorRemote] });

    expect(calls).toEqual([
      {
        query: UPDATE_DEFINITION_MUTATION,
        variables: {
          id: "gid://shopify/MetaobjectDefinition/author-1",
          definition: { fieldDefinitions: [{ update: { key: "name", name: "name", required: true, validations: [{ name: "max", value: "120" }] } }] },
        },
      },
    ]);
  });

  it("removeField is skipped by default and deletes the field under allowDestructive", async () => {
    const plan: DiffOp[] = [{ kind: "removeField", type: "$app:author", key: "legacy", destructive: true }];

    const safe = recordingClient();
    const safeResult = await push(safe.client, plan, { definitions: [authorDef], remote: [authorRemote] });
    expect(safe.calls).toEqual([]);
    expect(safeResult.results).toEqual([{ op: plan[0], status: "skipped", reason: "destructive" }]);

    const forced = recordingClient();
    const forcedResult = await push(forced.client, plan, { definitions: [authorDef], remote: [authorRemote] }, { allowDestructive: true });
    expect(forced.calls).toEqual([
      {
        query: UPDATE_DEFINITION_MUTATION,
        variables: {
          id: "gid://shopify/MetaobjectDefinition/author-1",
          definition: { fieldDefinitions: [{ delete: { key: "legacy" } }] },
        },
      },
    ]);
    expect(forcedResult.results).toEqual([{ op: plan[0], status: "applied", id: "gid://shopify/MetaobjectDefinition/author-1" }]);
  });

  it("changeFieldType deletes then re-creates the field under allowDestructive", async () => {
    const { client, calls } = recordingClient();
    const plan: DiffOp[] = [{ kind: "changeFieldType", type: "$app:author", key: "name", from: "number_integer", to: "single_line_text_field", destructive: true }];
    await push(client, plan, { definitions: [authorDef], remote: [authorRemote] }, { allowDestructive: true });

    expect(calls).toEqual([
      {
        query: UPDATE_DEFINITION_MUTATION,
        variables: {
          id: "gid://shopify/MetaobjectDefinition/author-1",
          definition: {
            fieldDefinitions: [
              { delete: { key: "name" } },
              { create: { key: "name", name: "name", required: true, type: "single_line_text_field", validations: [{ name: "max", value: "120" }] } },
            ],
          },
        },
      },
    ]);
  });

  it("reports userErrors as failed without throwing", async () => {
    const userErrors: UserError[] = [{ field: ["definition", "type"], message: "Type already taken", code: "TAKEN" }];
    const { client } = recordingClient({ createUserErrors: userErrors });
    const plan: DiffOp[] = [{ kind: "createDefinition", type: "$app:author", definition: normalizeLocal(Author) }];
    const result = await push(client, plan, { definitions: [authorDef], remote: [] });

    expect(result.results).toEqual([{ op: plan[0], status: "failed", userErrors }]);
    expect(result.counts.failed).toBe(1);
    expect(result.ok).toBe(false);
  });

  it("blocks a field op whose type has no known GID and is not created this run", async () => {
    const { client, calls } = recordingClient();
    const ghost = normalizeLocal(Author).fields[0]!;
    const plan: DiffOp[] = [{ kind: "addField", type: "$app:ghost", field: ghost }];
    const result = await push(client, plan, { definitions: [authorDef], remote: [] });

    expect(calls).toEqual([]);
    expect(result.results[0]?.status).toBe("blocked");
    expect(result.ok).toBe(false);
  });

  it("aggregates counts and ok across a mixed plan", async () => {
    const { client } = recordingClient();
    const bio = normalizeLocal(Author).fields[1]!;
    const plan: DiffOp[] = [
      { kind: "addField", type: "$app:author", field: bio },
      { kind: "removeField", type: "$app:author", key: "legacy", destructive: true },
    ];
    const result = await push(client, plan, { definitions: [authorDef], remote: [authorRemote] });

    expect(result.counts).toEqual({ applied: 1, skipped: 1, blocked: 0, failed: 0 });
    expect(result.ok).toBe(true);
  });

  it("propagates a transport throw", async () => {
    const { client } = recordingClient({ throwOnCall: true });
    const plan: DiffOp[] = [{ kind: "createDefinition", type: "$app:author", definition: normalizeLocal(Author) }];
    await expect(push(client, plan, { definitions: [authorDef], remote: [] })).rejects.toThrow("network down");
  });
});

const AuthorRef = defineMetaobject("author", { name: "Author", fields: { name: m.text({ required: true }) } });
const BookRef = defineMetaobject("book", {
  name: "Book",
  fields: { title: m.text({ required: true }), author: m.ref(AuthorRef) },
});

function createdTypes(calls: Call[]): string[] {
  return calls.map((c) => (c.variables?.definition as MetaobjectDefinitionInput).type);
}

describe("push — ordering and dependency gating", () => {
  it("creates a referenced type before its referencer regardless of plan order", async () => {
    const { client, calls } = recordingClient();
    // Plan lists Book (the referencer) first; topo sort must create Author first.
    const plan: DiffOp[] = [
      { kind: "createDefinition", type: "$app:book", definition: normalizeLocal(BookRef) },
      { kind: "createDefinition", type: "$app:author", definition: normalizeLocal(AuthorRef) },
    ];
    const result = await push(client, plan, {
      definitions: [AuthorRef.toDefinitionInput(), BookRef.toDefinitionInput()],
      remote: [],
    });

    expect(createdTypes(calls)).toEqual(["$app:author", "$app:book"]);
    expect(result.counts.applied).toBe(2);
    expect(result.ok).toBe(true);
  });

  it("blocks a create whose dependency failed instead of attempting it", async () => {
    const { client, calls } = recordingClient({ createUserErrors: [{ message: "Author rejected" }] });
    const plan: DiffOp[] = [
      { kind: "createDefinition", type: "$app:author", definition: normalizeLocal(AuthorRef) },
      { kind: "createDefinition", type: "$app:book", definition: normalizeLocal(BookRef) },
    ];
    const result = await push(client, plan, {
      definitions: [AuthorRef.toDefinitionInput(), BookRef.toDefinitionInput()],
      remote: [],
    });

    const author = result.results.find((r) => r.op.type === "$app:author");
    const book = result.results.find((r) => r.op.type === "$app:book");
    expect(author?.status).toBe("failed");
    expect(book?.status).toBe("blocked");
    if (book?.status === "blocked") expect(book.reason).toContain("$app:author");
    // Book's create was never attempted (only Author's failing call happened).
    expect(createdTypes(calls)).toEqual(["$app:author"]);
    expect(result.ok).toBe(false);
  });

  it("blocks both members of a reference cycle and attempts neither", async () => {
    // Plain type-refs build the cycle without circular schema type-inference;
    // referenceEdges only reads the metaobject_definition_type validation value.
    const A = defineMetaobject("a", { name: "A", fields: { b: m.ref({ type: "$app:b" }) } });
    const B = defineMetaobject("b", { name: "B", fields: { a: m.ref({ type: "$app:a" }) } });
    const { client, calls } = recordingClient();
    const plan: DiffOp[] = [
      { kind: "createDefinition", type: "$app:a", definition: normalizeLocal(A) },
      { kind: "createDefinition", type: "$app:b", definition: normalizeLocal(B) },
    ];
    const result = await push(client, plan, { definitions: [A.toDefinitionInput(), B.toDefinitionInput()], remote: [] });

    expect(calls).toEqual([]);
    expect(result.results.map((r) => r.status)).toEqual(["blocked", "blocked"]);
    for (const r of result.results) if (r.status === "blocked") expect(r.reason).toContain("cycle");
    expect(result.ok).toBe(false);
  });
});

describe("referenceEdges", () => {
  it("collects single metaobject_definition_type targets", () => {
    const def: MetaobjectDefinitionInput = {
      type: "$app:book",
      name: "Book",
      fieldDefinitions: [
        { key: "author", name: "Author", required: false, type: "metaobject_reference", validations: [{ name: "metaobject_definition_type", value: "$app:author" }] },
      ],
    };
    expect(referenceEdges(def)).toEqual(["$app:author"]);
  });

  it("collects list metaobject_definition_types targets from a JSON array", () => {
    const def: MetaobjectDefinitionInput = {
      type: "$app:shelf",
      name: "Shelf",
      fieldDefinitions: [
        { key: "books", name: "Books", required: false, type: "list.metaobject_reference", validations: [{ name: "metaobject_definition_types", value: JSON.stringify(["$app:book", "$app:author"]) }] },
      ],
    };
    expect(referenceEdges(def)).toEqual(["$app:book", "$app:author"]);
  });

  it("ignores a malformed metaobject_definition_types value", () => {
    const def: MetaobjectDefinitionInput = {
      type: "$app:x",
      name: "X",
      fieldDefinitions: [
        { key: "y", name: "Y", required: false, type: "list.metaobject_reference", validations: [{ name: "metaobject_definition_types", value: "not json" }] },
      ],
    };
    expect(referenceEdges(def)).toEqual([]);
  });
});
