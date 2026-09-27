/**
 * Scans ../lenra/app/api and emits src/routes/lenra/registry.generated.ts
 *
 *   npm run generate:routes
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_PROJECT_ROOT = path.resolve(__dirname, "..");
const API_ROOT = path.join(API_PROJECT_ROOT, "src/api-routes");
const OUT_FILE = path.resolve(__dirname, "../src/routes/lenra/registry.generated.ts");

type RouteEntry = {
  importPath: string;
  urlPattern: string;
  paramNames: string[];
};

function segmentToPattern(segment: string): { pattern: string; name?: string } {
  if (segment.startsWith("[[...") && segment.endsWith("]]")) {
    const name = segment.slice(5, -2);
    return { pattern: `:${name}{.+}?`, name };
  }
  if (segment.startsWith("[...") && segment.endsWith("]")) {
    const name = segment.slice(4, -1);
    return { pattern: `:${name}{.+}`, name };
  }
  if (segment.startsWith("[") && segment.endsWith("]")) {
    const name = segment.slice(1, -1);
    return { pattern: `:${name}`, name };
  }
  return { pattern: segment };
}

function walk(dir: string, segments: string[] = []): RouteEntry[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const routes: RouteEntry[] = [];

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      routes.push(...walk(full, [...segments, ent.name]));
      continue;
    }
    if (ent.name !== "route.ts") continue;

    // Stays on Next.js (uses next/cache revalidateTag)
    if (segments.includes("revalidate") || segments.includes("openapi")) continue;

    const paramNames: string[] = [];
    const patternParts = segments.map((seg) => {
      const converted = segmentToPattern(seg);
      if (converted.name) paramNames.push(converted.name);
      return converted.pattern;
    });

    const importPath = path
      .relative(path.dirname(OUT_FILE), full.replace(/\.ts$/, ".js"))
      .replace(/\\/g, "/")
      .replace(/^([^./])/, "./$1");

    routes.push({
      importPath,
      urlPattern: `/api/${patternParts.join("/")}`,
      paramNames,
    });
  }

  return routes;
}

const routes = walk(API_ROOT).sort((a, b) =>
  a.urlPattern.localeCompare(b.urlPattern),
);

const lines: string[] = [
  "/** Auto-generated — do not edit. Run: npm run generate:routes */",
  "",
  "export type LenraRouteHandler = (req: Request, ctx?: unknown) => Response | Promise<Response>;",
  "",
  "export type LenraRouteEntry = {",
  "  urlPattern: string;",
  "  paramNames: string[];",
  "  load: () => Promise<Record<string, unknown>>;",
  "};",
  "",
  "export const lenraRoutes: LenraRouteEntry[] = [",
];

for (const r of routes) {
  lines.push("  {");
  lines.push(`    urlPattern: ${JSON.stringify(r.urlPattern)},`);
  lines.push(`    paramNames: ${JSON.stringify(r.paramNames)},`);
  lines.push(
    `    load: () => import(${JSON.stringify(r.importPath)}),`,
  );
  lines.push("  },");
}

lines.push("];");
lines.push("");

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, lines.join("\n"));
console.log(`Wrote ${routes.length} routes to ${OUT_FILE}`);
