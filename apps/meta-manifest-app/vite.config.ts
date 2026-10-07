import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

// The worker runs in workerd, which only sees wrangler vars and .dev.vars —
// not this process's env. When the Shopify CLI is driving dev (it injects
// SHOPIFY_API_KEY), mirror its values (incl. the per-session tunnel URL)
// into .dev.vars so the workerd runtime gets them.
if (process.env.SHOPIFY_API_KEY) {
  const devVars = [
    "SHOPIFY_API_KEY",
    "SHOPIFY_API_SECRET",
    "SHOPIFY_APP_URL",
    "SCOPES",
    "SHOP_CUSTOM_DOMAIN",
  ]
    .filter((key) => process.env[key])
    .map((key) => `${key}=${JSON.stringify(process.env[key])}`)
    .join("\n");
  writeFileSync(
    fileURLToPath(new URL(".dev.vars", import.meta.url)),
    `${devVars}\n`,
  );
}

// Vite can't resolve the bare specifier ".prisma/client/default" (a
// dot-prefixed package only Node's CJS resolver handles) and would
// externalize it, breaking the worker bundle. Point it at the generated
// client's wasm entry — the build only ever targets workerd. Resolving via
// @prisma/client's realpath keeps the pnpm store hash out of the config.
const require = createRequire(import.meta.url);
const generatedClientDir = path.join(
  path.dirname(require.resolve("@prisma/client/package.json")),
  "../../.prisma/client",
);

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  resolve: {
    alias: {
      ".prisma/client/default": path.join(generatedClientDir, "wasm.js"),
    },
  },
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    reactRouter(),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
}) satisfies UserConfig;
