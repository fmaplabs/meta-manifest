import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CONFIG_TEMPLATE = `import { defineConfig } from "@fmaplabs/meta-manifest";

export default defineConfig({
  shop: "my-store.myshopify.com",
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
  // auth: "cli", // use a \`shopify store auth\` session instead of accessToken — see docs/CLI.md §2
  // auth: "client-credentials", // mint a 24h token per run from your Dev Dashboard app — see docs/CLI.md §2
  // clientId: process.env.SHOPIFY_CLIENT_ID!,
  // clientSecret: process.env.SHOPIFY_CLIENT_SECRET!,
  schema: "./src/schema.ts",
  // entries: "./src/entries.ts",
  // metafields: "./src/metafields.ts",
});
`;

const METAOBJECT_TEMPLATE = `import { defineMetaobject, m } from "@fmaplabs/meta-manifest";

export default defineMetaobject("author", {
  name: "Author",
  fields: {
    name: m.text({ required: true, max: 120 }),
    bio: m.multilineText(),
  },
});
`;

// One metaobject per file (default export); this module imports and aggregates them.
const SCHEMA_TEMPLATE = `import author from "./metaobjects/author";

export const schemas = [author];
`;

const ENV_PLACEHOLDER = `# Admin API access token (dot-env loaded by mm) — see docs/CLI.md §2 for both
# routes: a token from your app, or client credentials minted per run.
SHOPIFY_ADMIN_TOKEN=
# SHOPIFY_CLIENT_ID=
# SHOPIFY_CLIENT_SECRET=
`;

/** Scaffold config + schema files, never overwriting existing ones. */
export async function runInit(
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ created: string[] }> {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const created: string[] = [];
  const write = (rel: string, contents: string) => {
    const abs = join(cwd, rel);
    if (existsSync(abs)) return;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
    created.push(rel);
  };
  write("meta-manifest.config.ts", CONFIG_TEMPLATE);
  write("src/metaobjects/author.ts", METAOBJECT_TEMPLATE);
  write("src/schema.ts", SCHEMA_TEMPLATE);

  // .env is never overwritten; a token already exported is persisted (its
  // value is written to the file but never echoed to the console).
  const tokenPersisted = Boolean(env.SHOPIFY_ADMIN_TOKEN) && !existsSync(join(cwd, ".env"));
  write(".env", env.SHOPIFY_ADMIN_TOKEN ? `SHOPIFY_ADMIN_TOKEN=${env.SHOPIFY_ADMIN_TOKEN}\n` : ENV_PLACEHOLDER);

  // .gitignore is the one file init may modify: .env must never be committed.
  const gitignore = join(cwd, ".gitignore");
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, ".env\n");
    created.push(".gitignore");
  } else {
    const contents = readFileSync(gitignore, "utf8");
    if (!contents.split("\n").some((l) => l.trim() === ".env" || l.trim() === "/.env")) {
      // A file without a trailing newline would otherwise glue ".env" onto its last rule.
      appendFileSync(gitignore, contents === "" || contents.endsWith("\n") ? ".env\n" : "\n.env\n");
      console.log("Added .env to .gitignore.");
    }
  }

  if (created.length) {
    console.log(`Created: ${created.join(", ")}`);
    console.log(
      tokenPersisted
        ? "Saved SHOPIFY_ADMIN_TOKEN from your environment into .env. Next: edit meta-manifest.config.ts, then run `mm diff`."
        : "Next: put SHOPIFY_ADMIN_TOKEN (or SHOPIFY_CLIENT_ID/SECRET) in .env, edit meta-manifest.config.ts, then run `mm diff`.",
    );
  } else {
    console.log("Nothing to do — config and schema already exist.");
  }
  return { created };
}
