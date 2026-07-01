import { resolve } from "node:path";

/**
 * Load a `.env` file from `cwd` into `process.env`, if one exists. Node does not
 * read `.env` automatically, so the CLI does it here before evaluating the config
 * (which reads secrets like `SHOPIFY_ADMIN_TOKEN` via `process.env`).
 *
 * Variables already present in the real environment win over the file, and a
 * missing `.env` is a silent no-op. Any other error (e.g. a malformed file)
 * surfaces so it isn't hidden.
 */
export function loadDotEnv(cwd = process.cwd()): void {
  try {
    process.loadEnvFile(resolve(cwd, ".env"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
