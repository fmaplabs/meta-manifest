import type { PrismaClient } from "@prisma/client";
import { createShopifyApp, type AppShopify } from "./shopify.server";

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
    shopify: AppShopify;
    db: PrismaClient;
  }
}

export function getLoadContext({
  env,
  ctx,
}: {
  env: Env;
  ctx: ExecutionContext;
}) {
  const { shopify, db } = createShopifyApp(env);

  return {
    cloudflare: { env, ctx },
    shopify,
    db,
  };
}
