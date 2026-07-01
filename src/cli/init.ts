import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CONFIG_TEMPLATE = `import { defineConfig } from "@fmaplabs/meta-manifest";

export default defineConfig({
  shop: "my-store.myshopify.com",
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  schema: "./src/schema.ts",
});
`;

const SCHEMA_TEMPLATE = `import { defineMetaobject, m } from "@fmaplabs/meta-manifest";

export const Author = defineMetaobject("author", {
  name: "Author",
  fields: {
    name: m.text({ required: true, max: 120 }),
    bio: m.multilineText(),
  },
});

export const schemas = [Author];
`;

/** Scaffold config + schema files, never overwriting existing ones. */
export async function runInit(opts: { cwd?: string } = {}): Promise<{ created: string[] }> {
  const cwd = opts.cwd ?? process.cwd();
  const created: string[] = [];
  const write = (rel: string, contents: string) => {
    const abs = join(cwd, rel);
    if (existsSync(abs)) return;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
    created.push(rel);
  };
  write("meta-manifest.config.ts", CONFIG_TEMPLATE);
  write("src/schema.ts", SCHEMA_TEMPLATE);
  if (created.length) {
    console.log(`Created: ${created.join(", ")}`);
    console.log("Next: set SHOPIFY_ADMIN_TOKEN in your env, edit meta-manifest.config.ts, then run `mm diff`.");
  } else {
    console.log("Nothing to do — config and schema already exist.");
  }
  return { created };
}
