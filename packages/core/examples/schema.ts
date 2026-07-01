/**
 * Example schemas: a small catalog domain that exercises most of the builder
 * surface and a cross-definition reference.
 *
 * `Product` references `Material` (via `list(ref(Material))`), so `push` must
 * create `Material` first — see `sync.ts` and `../docs/SYNC.md`.
 *
 * In your app you would import from the package name:
 *
 *   import { defineMetaobject, m } from "@meta-manifest/core";
 *
 * These files live inside the package, so they import from the source directly.
 */
import { defineMetaobject, m } from "../src/index";

/** A raw material a product can be made of. Referenced by `Product.specs`. */
export const Material = defineMetaobject("material", {
  name: "Material",
  displayName: "name",
  fields: {
    name: m.text({ required: true, max: 80 }),
    // Measurement value+unit, e.g. { value: 2.7, unit: "GRAMS" }.
    density: m.weight(),
  },
});

/** A product spec sheet. Note: this is an app-owned metaobject (`$app:product_spec`),
 *  distinct from Shopify's native Product (which you'd reference via `m.product()`). */
export const Product = defineMetaobject("product_spec", {
  name: "Product Spec",
  displayName: "title",
  access: { storefront: "public_read" },
  fields: {
    title: m.text({ required: true, max: 120 }),
    // Money is { amount, currencyCode }, stored as a JSON string on the wire.
    price: m.money(),
    // A list of references to the Material definition above. This is the
    // dependency edge that forces Material to be created before Product.
    specs: m.list(m.ref(Material)),
    // A list of file references, restricted to images.
    gallery: m.list(m.file({ accept: ["Image"] })),
    // Measurement value+unit, e.g. { value: 30, unit: "CENTIMETERS" }.
    dimensions: m.dimension(),
    // Rating on a fixed 1..5 scale.
    rating: m.rating({ min: 1, max: 5 }),
  },
});

/**
 * The full set of definitions this app owns. `pull`/`push` take the `type`
 * strings and `toDefinitionInput()` outputs from these.
 */
export const schemas = [Material, Product];
