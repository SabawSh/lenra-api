import { paths } from "@/lib/openapi/paths";
import { schemas } from "@/lib/openapi/schemas";

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Lenra API",
    version: "0.1.0",
    description:
      "HTTP API for Lenra — learn English through film clips. Session auth uses the `lenra_session` cookie. Media/admin routes also accept `Authorization: Bearer <CLOUD_UPLOAD_API_KEY>`. Cache revalidation uses `REVALIDATE_SECRET` in the request body.",
    contact: {
      name: "Lenra",
      url: "https://lenra.ir",
    },
  },
  servers: [
    {
      url: "/",
      description: "Current host (relative to app origin)",
    },
  ],
  tags: [
    { name: "Auth", description: "Sign-in, session, OAuth, phone OTP" },
    { name: "Payments", description: "BitPay gateway start and verification" },
    { name: "Onboarding", description: "User profile setup" },
    { name: "Vocabulary", description: "Saved words and spaced repetition" },
    { name: "Learning", description: "Clip performance and learning time" },
    { name: "Reminders", description: "Review reminders" },
    { name: "User", description: "Profile and avatar" },
    { name: "Gamification", description: "XP and levels" },
    { name: "Episodes", description: "Episode sections and resume position" },
    { name: "Videos", description: "Video library interactions" },
    { name: "Media", description: "S3 presign, commit, HLS (site media admin)" },
    { name: "Admin", description: "Catalog seeding and cover management" },
    { name: "Cache", description: "Next.js tag revalidation" },
  ],
  paths,
  components: {
    schemas,
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "lenra_session",
        description: "JWT session set after phone verify or Google OAuth",
      },
      uploadApiKey: {
        type: "http",
        scheme: "bearer",
        description:
          "Bearer token matching env CLOUD_UPLOAD_API_KEY (CLI / tooling)",
      },
    },
  },
} as const;

export type OpenApiSpec = typeof openApiSpec;
