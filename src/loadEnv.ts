import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const lenraFrontendRoot = path.resolve(apiRoot, "../lenra");

/** Backend env first; optional ../lenra/.env.local for shared dev secrets. */
export function loadLenraEnv(): void {
  dotenv.config({ path: path.join(apiRoot, ".env") });
  dotenv.config({ path: path.join(apiRoot, ".env.local"), override: true });
  dotenv.config({ path: path.join(lenraFrontendRoot, ".env"), override: true });
  dotenv.config({ path: path.join(lenraFrontendRoot, ".env.local"), override: true });
}
