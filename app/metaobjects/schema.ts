/**
 * The metaobject definitions this app owns. These are the source of truth that
 * the /app/metaobjects page pulls, diffs, and pushes to the store.
 *
 * See packages/core/docs/SYNC.md for the full sync model.
 */
import { defineMetaobject, m } from "@meta-manifest/core";

/** A raw material. Referenced by `Product.specs`. */
export const Material = defineMetaobject("material", {
  name: "Material",
  displayName: "name",
  fields: {
    name: m.text({ required: true, max: 80 }),
    density: m.weight(),
  },
});

/** An app-owned product spec sheet (distinct from Shopify's native Product). */
export const Product = defineMetaobject("product_spec", {
  name: "Product Spec",
  displayName: "title",
  access: { storefront: "public_read" },
  fields: {
    title: m.text({ required: true, max: 120 }),
    price: m.money(),
    // References Material, so `push` creates Material first.
    specs: m.list(m.ref(Material)),
    rating: m.rating({ min: 1, max: 5 }),
  },
});

/** Every definition the app manages. */
export const schemas = [Material, Product];
