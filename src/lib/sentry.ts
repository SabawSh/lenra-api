import * as Sentry from "@sentry/node";

let initialized = false;

export function initApiSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    beforeSend(event) {
      if (event.request?.headers) {
        const headers = { ...event.request.headers };
        delete headers.cookie;
        delete headers.authorization;
        delete headers.Authorization;
        event.request.headers = headers;
      }
      return event;
    },
  });
  initialized = true;
}

export { Sentry };
