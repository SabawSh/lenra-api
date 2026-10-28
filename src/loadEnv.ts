import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeEnvValue } from "./config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const lenraFrontendRoot = path.resolve(apiRoot, "../lenra");

/**
 * Hosting panels and `docker --env-file` keep quotes literally (`KEY="value"`),
 * which breaks values such as the S3 bucket name and access key.
 */
function stripWrappingQuotesFromEnv(): void {
  for (const [key, raw] of Object.entries(process.env)) {
    if (raw === undefined) continue;
    const value = normalizeEnvValue(raw);
    if (value !== raw.trim()) process.env[key] = value;
  }
}

/** Backend env first; optional ../lenra/.env.local for shared dev secrets. */
export function loadLenraEnv(): void {
  dotenv.config({ path: path.join(apiRoot, ".env") });
  dotenv.config({ path: path.join(apiRoot, ".env.local"), override: true });
  dotenv.config({ path: path.join(lenraFrontendRoot, ".env"), override: true });
  dotenv.config({ path: path.join(lenraFrontendRoot, ".env.local"), override: true });
  stripWrappingQuotesFromEnv();
}
