# @meta-manifest/core

Zero-dependency, zod-style builder for Shopify metaobject definitions. Declares definitions, validates values, and maps schemas to/from the Admin API. Implements [Standard Schema](https://github.com/standard-schema/standard-schema).

## Usage

```ts
import { defineMetaobject, m, type Infer } from "@meta-manifest/core";

export const Author = defineMetaobject("author", {
  name: "Author",
  displayName: "name",
  access: { storefront: "public_read" },
  fields: {
    name: m.text({ required: true, max: 120 }),
    bio: m.multilineText(),
    rating: m.rating({ min: 1, max: 5 }),
  },
});

type AuthorValue = Infer<typeof Author.fields>;

Author.type;                 // "$app:author"
Author.toDefinitionInput();  // MetaobjectDefinitionCreateInput (for metaobjectDefinitionCreate)
Author.parse(fields);        // Shopify {key, jsonValue}[] -> typed, validated
Author.encode({ name: "Ursula" }); // typed -> [{ key, value }] for metaobjectUpsert
```

## Status

v1: schema core + value codecs + `diff()` planning. Networked push/pull and the dashboard are tracked separately.
