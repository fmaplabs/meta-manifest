# Shopify app development

This app is scaffolded from a Shopify app template. See the README for framework-specific details.

It has since diverged from the template: it runs on Cloudflare Workers.

- No module-scope singletons: `shopifyApp()`/`PrismaClient` are built per request — routes use `context.shopify` / `context.db` from the load context, never `import { authenticate } from "../shopify.server"` (that export is gone; Workers forbids cross-request I/O).
- Schema changes go through wrangler D1 migrations + `prisma migrate diff`, not `prisma migrate dev` — flow in README § Changing the schema.
- `Env` type errors on a fresh clone are expected until `pnpm typecheck` (or `pnpm typegen`) generates the gitignored `worker-configuration.d.ts`.

Use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) for all Shopify API and platform work. If missing, install it in the agent host per that page (or `npx skills add Shopify/shopify-ai-toolkit --list` for skill-compatible hosts) — do not add tooling to this repo.
