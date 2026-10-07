import { describe, expect, it } from "vitest";
import {
  defineEntries,
  defineMetaobject,
  diff,
  diffEntries,
  entryRef,
  m,
  normalizeLocal,
  normalizeRemote,
  pull,
  pullEntries,
  push,
  pushEntries,
  resolveEntries,
  type AdminGraphQLClient,
} from "../index";
import {
  CREATE_DEFINITION_MUTATION,
  PULL_DEFINITION_QUERY,
  PULL_ENTRY_QUERY,
  UPDATE_DEFINITION_MUTATION,
  UPSERT_ENTRY_MUTATION,
} from "./client";

// A stateful fake store: definitions always create (pull misses), entries are
// persisted with metaobjectUpsert's partial-update semantics and served back by
// handle — so a second run can prove idempotence.
function fakeStore() {
  const log: string[] = [];
  const stored = new Map<string, { id: string; fields: Map<string, string>; status?: string }>();
  let defCounter = 0;
  let entryCounter = 0;
  const client: AdminGraphQLClient = async (query, options) => {
    const vars = options?.variables ?? {};
    if (query === PULL_DEFINITION_QUERY) return { data: { metaobjectDefinitionByType: null } };
    if (query === CREATE_DEFINITION_MUTATION) {
      const def = vars.definition as { type: string };
      log.push(`createDefinition:${def.type}`);
      defCounter += 1;
      return {
        data: {
          metaobjectDefinitionCreate: {
            metaobjectDefinition: { id: `gid://shopify/MetaobjectDefinition/${defCounter}`, type: def.type },
            userErrors: [],
          },
        },
      };
    }
    if (query === UPDATE_DEFINITION_MUTATION) {
      log.push("updateDefinition");
      return { data: { metaobjectDefinitionUpdate: { metaobjectDefinition: { id: vars.id as string }, userErrors: [] } } };
    }
    if (query === PULL_ENTRY_QUERY) {
      const h = vars.handle as { type: string; handle: string };
      const e = stored.get(`${h.type}/${h.handle}`);
      return {
        data: {
          metaobjectByHandle: e
            ? {
                id: e.id,
                handle: h.handle,
                type: h.type,
                fields: [...e.fields].map(([key, value]) => ({ key, value })),
                capabilities: e.status ? { publishable: { status: e.status } } : null,
              }
            : null,
        },
      };
    }
    if (query === UPSERT_ENTRY_MUTATION) {
      const h = vars.handle as { type: string; handle: string };
      const input = vars.metaobject as {
        fields?: Array<{ key: string; value: string }>;
        capabilities?: { publishable?: { status?: string } };
      };
      const key = `${h.type}/${h.handle}`;
      let e = stored.get(key);
      if (!e) {
        entryCounter += 1;
        e = { id: `gid://shopify/Metaobject/${entryCounter}`, fields: new Map() };
        stored.set(key, e);
      }
      for (const f of input.fields ?? []) e.fields.set(f.key, f.value);
      if (input.capabilities?.publishable?.status) e.status = input.capabilities.publishable.status;
      log.push(`upsertEntry:${key}:${(input.fields ?? []).map((f) => f.key).join(",")}`);
      return { data: { metaobjectUpsert: { metaobject: { id: e.id, handle: h.handle }, userErrors: [] } } };
    }
    return { data: {} };
  };
  return { client, log, stored };
}

const Author = defineMetaobject("author", {
  name: "Author",
  capabilities: { publishable: true },
  fields: { name: m.text({ required: true }), favoriteBook: m.ref({ type: "$app:book" }) },
});
const Book = defineMetaobject("book", {
  name: "Book",
  fields: { title: m.text({ required: true }), author: m.ref({ type: "$app:author" }) },
});
const schemas = [Author, Book];

const entrySets = [
  defineEntries(Book, {
    persuasion: { title: "Persuasion", author: entryRef(Author, "jane") },
  }),
  defineEntries(Author, { jane: { name: "Jane", favoriteBook: entryRef(Book, "persuasion") } }, { status: "active" }),
];

describe("entries end-to-end: definitions push, then a cyclic entry seed, then idempotence", () => {
  it("creates definitions before entries, breaks the entry cycle two-pass, and re-diffs to zero", async () => {
    const { client, log } = fakeStore();

    // Definitions phase (Author↔Book is itself a definition cycle → two-pass).
    const remote = await pull(client, [Author.type, Book.type]);
    const local = [normalizeLocal(Author), normalizeLocal(Book)];
    const plan = diff(local, remote.map((r) => normalizeRemote(r.definition)));
    const defResult = await push(client, plan, {
      definitions: [Author.toDefinitionInput(), Book.toDefinitionInput()],
      remote,
    });
    expect(defResult.ok).toBe(true);

    // Entries phase.
    const { entries, issues } = resolveEntries(entrySets, schemas);
    expect(issues).toEqual([]);
    const entryRemote = await pullEntries(client, entries.map((e) => ({ type: e.type, handle: e.handle })));
    expect(entryRemote).toEqual([]);
    const entryPlan = diffEntries(entries, entryRemote);
    expect(entryPlan).toEqual([
      { kind: "createEntry", type: "$app:book", handle: "persuasion" },
      { kind: "createEntry", type: "$app:author", handle: "jane" },
    ]);
    const entryResult = await pushEntries(client, entryPlan, { entries, remote: entryRemote });
    expect(entryResult.ok).toBe(true);
    expect(entryResult.counts).toEqual({ applied: 2, blocked: 0, failed: 0 });

    // Every definition create ran before any entry upsert…
    const firstUpsert = log.findIndex((l) => l.startsWith("upsertEntry"));
    expect(log.slice(0, firstUpsert).every((l) => !l.startsWith("upsertEntry"))).toBe(true);
    // …and the cycle broke two-pass: the book created without its unresolvable
    // ref, jane's create resolved the fresh book GID inline, and a pass-2 upsert
    // patched the book's ref field.
    expect(log.filter((l) => l.startsWith("upsertEntry"))).toEqual([
      "upsertEntry:$app:book/persuasion:title",
      "upsertEntry:$app:author/jane:name,favoriteBook",
      "upsertEntry:$app:book/persuasion:author",
    ]);

    // Second run over the now-populated store: everything is in sync.
    const entryRemote2 = await pullEntries(client, entries.map((e) => ({ type: e.type, handle: e.handle })));
    expect(entryRemote2).toHaveLength(2);
    expect(diffEntries(entries, entryRemote2)).toEqual([]);
  });

  it("stores resolved GIDs and the declared status on the fake store", async () => {
    const { client, stored } = fakeStore();
    const { entries } = resolveEntries(entrySets, schemas);
    const entryPlan = diffEntries(entries, []);
    await pushEntries(client, entryPlan, { entries, remote: [] });

    const book = stored.get("$app:book/persuasion");
    const jane = stored.get("$app:author/jane");
    expect(book?.fields.get("author")).toBe(jane?.id);
    expect(jane?.fields.get("favoriteBook")).toBe(book?.id);
    expect(jane?.status).toBe("ACTIVE");
    expect(book?.status).toBeUndefined();
  });
});
