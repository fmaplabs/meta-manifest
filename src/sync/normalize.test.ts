import { describe, expect, it } from "vitest";
import { defineMetaobject, m } from "../index";
import { normalizeLocal, normalizeRemote } from "./normalize";

describe("normalizeLocal — capabilities & access", () => {
  it("represents onlineStore as disabled when the schema omits it (absence disables)", () => {
    const S = defineMetaobject("s", { name: "S", fields: { n: m.text() } });
    expect(normalizeLocal(S).capabilities).toEqual({ onlineStore: { enabled: false } });
  });

  it("carries declared capabilities (enabled + data), access, and per-field filterable", () => {
    const S = defineMetaobject("s", {
      name: "S",
      access: { storefront: "public_read", customerAccount: "read" },
      capabilities: {
        publishable: false,
        renderable: { metaTitleKey: "title" },
        onlineStore: { urlHandle: "s", createRedirects: true },
      },
      fields: { title: m.text({ filterable: true }) },
    });
    const n = normalizeLocal(S);
    expect(n.access).toEqual({ storefront: "PUBLIC_READ", customerAccount: "READ" });
    expect(n.capabilities).toEqual({
      publishable: { enabled: false },
      renderable: { enabled: true, data: { metaTitleKey: "title" } },
      // createRedirects is write-only (not queried), so it is dropped from the comparison shape.
      onlineStore: { enabled: true, data: { urlHandle: "s" } },
    });
    expect(n.fields[0].filterable).toBe(true);
  });
});

describe("normalizeRemote — capabilities & access", () => {
  it("drops null access/data and reads adminFilterable per field", () => {
    const r = normalizeRemote({
      type: "$app:s",
      name: "S",
      access: { admin: "MERCHANT_READ", storefront: null, customerAccount: "NONE" },
      capabilities: {
        publishable: { enabled: true },
        renderable: { enabled: true, data: { metaTitleKey: "title", metaDescriptionKey: null } },
        onlineStore: { enabled: false, data: null },
      },
      fieldDefinitions: [
        { key: "title", type: { name: "single_line_text_field" }, required: false, validations: [], capabilities: { adminFilterable: { enabled: true } } },
      ],
    });
    expect(r.access).toEqual({ admin: "MERCHANT_READ", customerAccount: "NONE" });
    expect(r.capabilities).toEqual({
      publishable: { enabled: true },
      renderable: { enabled: true, data: { metaTitleKey: "title" } },
      onlineStore: { enabled: false },
    });
    expect(r.fields[0].filterable).toBe(true);
  });
});
