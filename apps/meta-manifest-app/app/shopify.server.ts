import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

export const apiVersion = ApiVersion.July26;

// Secrets (wrangler secret put) and optional vars are invisible to
// `wrangler types`, so they aren't part of the generated Env.
type ShopifyEnv = Env & {
  SHOPIFY_API_SECRET?: string;
  SHOP_CUSTOM_DOMAIN?: string;
};

// Built once per request (see app/load-context.ts): Workers forbids I/O that
// crosses requests, and PrismaSessionStorage's constructor polls the Session
// table. connectionRetries: 1 keeps that poll to a single fast query.
export function createShopifyApp(env: ShopifyEnv) {
  const db = new PrismaClient({ adapter: new PrismaD1(env.DB) });

  const shopify = shopifyApp({
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET || "",
    apiVersion,
    scopes: env.SCOPES?.split(","),
    appUrl: env.SHOPIFY_APP_URL || "",
    authPathPrefix: "/auth",
    sessionStorage: new PrismaSessionStorage(db, {
      connectionRetries: 1,
      connectionRetryIntervalMs: 0,
    }),
    distribution: AppDistribution.AppStore,
    future: {
      expiringOfflineAccessTokens: true,
    },
    ...(env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });

  return { shopify, db };
}

export type AppShopify = ReturnType<typeof createShopifyApp>["shopify"];
