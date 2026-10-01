import type { LenraRouteEntry } from "./registry.generated.js";

export type MatchedLenraRoute = {
  entry: LenraRouteEntry;
  params: Record<string, string>;
};

function patternToRegex(urlPattern: string, paramNames: string[]): RegExp {
  let regexStr = "^";
  const parts = urlPattern.split("/").filter(Boolean);
  for (const part of parts) {
    regexStr += "/";
    if (part.startsWith(":")) {
      const rest = part.slice(1);
      if (rest.endsWith("{.+}?")) {
        const name = rest.slice(0, -5);
        if (!paramNames.includes(name)) paramNames.push(name);
        regexStr += `(?<${name}>.+?)`;
      } else if (rest.endsWith("{.+}")) {
        const name = rest.slice(0, -4);
        if (!paramNames.includes(name)) paramNames.push(name);
        regexStr += `(?<${name}>.+)`;
      } else {
        if (!paramNames.includes(rest)) paramNames.push(rest);
        regexStr += `(?<${rest}>[^/]+)`;
      }
    } else {
      regexStr += part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  regexStr += "/?$";
  return new RegExp(regexStr);
}

const compiled: Array<{
  entry: LenraRouteEntry;
  regex: RegExp;
  paramNames: string[];
}> = [];

export function compileRoutes(entries: LenraRouteEntry[]): void {
  compiled.length = 0;
  // Prefer static path segments over `:param` so
  // `/api/flashcards/search` wins over `/api/flashcards/:id`.
  const ranked = [...entries].sort((a, b) => {
    const staticScore = (pattern: string) =>
      pattern
        .split("/")
        .filter(Boolean)
        .reduce((score, part) => score + (part.startsWith(":") ? 0 : 1), 0);
    const diff = staticScore(b.urlPattern) - staticScore(a.urlPattern);
    if (diff !== 0) return diff;
    return a.urlPattern.localeCompare(b.urlPattern);
  });
  for (const entry of ranked) {
    const names = [...entry.paramNames];
    compiled.push({
      entry,
      regex: patternToRegex(entry.urlPattern, names),
      paramNames: names,
    });
  }
}

export function matchLenraRoute(pathname: string): MatchedLenraRoute | null {
  const path = pathname.split("?")[0] ?? pathname;
  for (const { entry, regex } of compiled) {
    const m = regex.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    if (m.groups) {
      for (const [key, value] of Object.entries(m.groups)) {
        if (value != null) params[key] = value;
      }
    }
    return { entry, params };
  }
  return null;
}
