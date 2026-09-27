import { openApiSpec as lenraSpec } from "@/lib/openapi/spec.js";

export function openApiSpecForServer(publicBaseUrl: string) {
  const base = publicBaseUrl.replace(/\/+$/, "");
  return {
    ...lenraSpec,
    servers: [
      {
        url: base,
        description: "lenra-api",
      },
    ],
  };
}
