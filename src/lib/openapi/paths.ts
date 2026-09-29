type Paths = Record<string, Record<string, unknown>>;

const json = { "application/json": {} };
const sessionSecurity = [{ sessionCookie: [] as string[] }];
const mediaSecurity = [
  { sessionCookie: [] as string[] },
  { uploadApiKey: [] as string[] },
];

const unauthorized = {
  "401": {
    description: "Unauthorized",
    content: { ...json, "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  },
};
const invalidJson = {
  "400": {
    description: "Invalid JSON",
    content: { ...json, "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  },
};

export const paths: Paths = {
  "/api/payments/bitpay/start": {
    post: {
      tags: ["Payments"],
      summary: "Create BitPay payment session",
      description:
        "Creates a BitPay payment `get_id` and returns the bank redirect URL.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["amount", "redirect"],
              properties: {
                amount: { type: "integer", minimum: 5000 },
                redirect: { type: "string" },
                name: { type: "string" },
                email: { type: "string" },
                description: { type: "string" },
                factorId: { type: "integer" },
                mobileNum: { type: "string" },
                cardNum: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "BitPay session created" },
        "400": { description: "Invalid payload or gateway rejected request" },
        "502": { description: "BitPay unavailable / invalid upstream response" },
      },
    },
  },
  "/api/payments/bitpay/verify": {
    post: {
      tags: ["Payments"],
      summary: "Verify BitPay transaction",
      description:
        "Verifies a callback pair (`id_trans`, `get_id`) against BitPay result endpoint.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["id_trans", "get_id"],
              properties: {
                id_trans: { type: "integer", minimum: 1 },
                get_id: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Verification status from BitPay" },
        "400": { description: "Invalid callback values" },
        "502": { description: "BitPay unavailable / invalid upstream response" },
      },
    },
  },
  "/api/auth/me": {
    get: {
      tags: ["Auth"],
      summary: "Current signed-in user",
      description: "Returns the session user or `null` if not authenticated.",
      responses: {
        "200": {
          description: "Current user",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthMeResponse" },
            },
          },
        },
      },
    },
  },
  "/api/auth/sign-out": {
    post: {
      tags: ["Auth"],
      summary: "Sign out",
      description: "Clears the session cookie.",
      responses: {
        "200": {
          description: "Signed out",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OkResponse" },
            },
          },
        },
      },
    },
  },
  "/api/auth/google/start": {
    get: {
      tags: ["Auth"],
      summary: "Start Google OAuth",
      parameters: [
        {
          name: "next",
          in: "query",
          schema: { type: "string", default: "/" },
          description: "Post-login redirect path",
        },
      ],
      responses: {
        "302": { description: "Redirect to Google OAuth" },
      },
    },
  },
  "/api/auth/google/callback": {
    get: {
      tags: ["Auth"],
      summary: "Google OAuth callback",
      parameters: [
        { name: "code", in: "query", schema: { type: "string" } },
        { name: "state", in: "query", schema: { type: "string" } },
        { name: "error", in: "query", schema: { type: "string" } },
      ],
      responses: {
        "302": { description: "Redirect to app or sign-in with error" },
      },
    },
  },
  "/api/auth/phone/start": {
    post: {
      tags: ["Auth"],
      summary: "Request phone OTP",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PhoneStartRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "OTP sent",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PhoneStartResponse" },
            },
          },
        },
        "400": { description: "Invalid phone or JSON" },
        "429": { description: "Cooldown — retry after retryAfterMs" },
        "502": { description: "SMS delivery failed" },
      },
    },
  },
  "/api/auth/phone/verify": {
    post: {
      tags: ["Auth"],
      summary: "Verify phone OTP and create session",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PhoneVerifyRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Verified — session cookie set",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PhoneVerifyResponse" },
            },
          },
        },
        "400": { description: "Invalid phone or code format" },
        "401": { description: "Invalid or expired OTP" },
      },
    },
  },
  "/api/onboarding": {
    patch: {
      tags: ["Onboarding"],
      summary: "Save onboarding fields",
      security: sessionSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/OnboardingPatchRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Updated user record" },
        "400": { description: "Invalid fields" },
        "401": unauthorized["401"],
        "409": { description: "Username taken" },
      },
    },
  },
  "/api/onboarding/check-username": {
    get: {
      tags: ["Onboarding"],
      summary: "Check username availability",
      security: sessionSecurity,
      parameters: [
        {
          name: "username",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Availability result",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UsernameCheckResponse" },
            },
          },
        },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/vocabulary": {
    post: {
      tags: ["Vocabulary"],
      summary: "Save vocabulary card",
      security: sessionSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/VocabularySaveRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Card saved" },
        "400": { description: "Invalid payload" },
        "401": unauthorized["401"],
        "404": { description: "Clip not found" },
      },
    },
  },
  "/api/vocabulary/{id}": {
    patch: {
      tags: ["Vocabulary"],
      summary: "Record vocabulary review outcome",
      security: sessionSecurity,
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/VocabularyReviewRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Card updated" },
        "400": { description: "Invalid payload" },
        "401": unauthorized["401"],
        "404": { description: "Card not found" },
      },
    },
    delete: {
      tags: ["Vocabulary"],
      summary: "Delete saved vocabulary card",
      security: sessionSecurity,
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Deleted" },
        "401": unauthorized["401"],
        "404": { description: "Card not found" },
      },
    },
  },
  "/api/reminders": {
    post: {
      tags: ["Reminders"],
      summary: "Upsert part reminder",
      security: sessionSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ReminderCreateRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Reminder created or updated" },
        "400": { description: "Missing partId or dueAt" },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/performance": {
    post: {
      tags: ["Learning"],
      summary: "Record clip performance and award XP",
      security: sessionSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/PerformanceRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Progress and gamification summary" },
        "400": { description: "Invalid payload" },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/attempts": {
    post: {
      tags: ["Learning"],
      summary: "Increment learning time",
      security: sessionSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LearningTimeRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Time recorded" },
        "400": { description: "Invalid learningTimeMs" },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/user/avatar": {
    post: {
      tags: ["User"],
      summary: "Upload profile avatar",
      security: sessionSecurity,
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file"],
              properties: {
                file: { type: "string", format: "binary" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Avatar URL",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ok: { type: "boolean" },
                  avatarUrl: { type: "string" },
                },
              },
            },
          },
        },
        "400": { description: "Invalid file" },
        "401": unauthorized["401"],
        "502": { description: "S3 upload failed" },
      },
    },
  },
  "/api/gamification/progression": {
    get: {
      tags: ["Gamification"],
      summary: "XP level progression",
      security: sessionSecurity,
      responses: {
        "200": { description: "Progression and daily XP" },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/gamification/xp": {
    post: {
      tags: ["Gamification"],
      summary: "Award XP for a reason",
      security: sessionSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/XpAwardRequest" },
          },
        },
      },
      responses: {
        "200": { description: "XP awarded" },
        "400": { description: "Invalid reason" },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/episodes/{episodeId}/sections-state": {
    get: {
      tags: ["Episodes"],
      summary: "Episode sections unlock state",
      parameters: [
        {
          name: "episodeId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "videoId",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "seasonId",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Sections, deferred sections, review cards, last position",
        },
        "400": { description: "Invalid params" },
        "404": { description: "Episode has no clips" },
      },
    },
  },
  "/api/episodes/{episodeId}/section-clip-batch": {
    post: {
      tags: ["Episodes"],
      summary: "First-clip CDN URLs for section batch",
      parameters: [
        {
          name: "episodeId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/SectionClipBatchRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Map of section index to clip URL",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  firstClipUrls: {
                    type: "object",
                    additionalProperties: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
        },
        "400": invalidJson["400"],
        "404": { description: "Episode has no clips" },
      },
    },
  },
  "/api/episodes/{episodeId}/last-position": {
    get: {
      tags: ["Episodes"],
      summary: "Get saved episode position",
      security: sessionSecurity,
      parameters: [
        {
          name: "episodeId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "videoId",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Position or null when guest",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  position: { type: "object", nullable: true },
                },
              },
            },
          },
        },
        "400": { description: "Invalid params" },
      },
    },
    post: {
      tags: ["Episodes"],
      summary: "Save episode playback position",
      security: sessionSecurity,
      parameters: [
        {
          name: "episodeId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/EpisodeLastPositionBody" },
          },
        },
      },
      responses: {
        "200": { description: "Saved (no-op for guests)" },
        "400": { description: "Invalid body" },
      },
    },
  },
  "/api/videos/{videoId}/like": {
    post: {
      tags: ["Videos"],
      summary: "Like or unlike a video",
      security: sessionSecurity,
      parameters: [
        {
          name: "videoId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/VideoLikeRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "New liked state",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { isLiked: { type: "boolean" } },
              },
            },
          },
        },
        "401": unauthorized["401"],
        "404": { description: "Video not found" },
      },
    },
  },
  "/api/last-seen/season": {
    get: {
      tags: ["Episodes"],
      summary: "Last seen episode in a season",
      security: sessionSecurity,
      parameters: [
        { name: "videoId", in: "query", required: true, schema: { type: "string" } },
        { name: "seasonId", in: "query", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "Last seen episode and order",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  episodeId: { type: "string", nullable: true },
                  order: { type: "integer" },
                },
              },
            },
          },
        },
        "400": { description: "Invalid params" },
      },
    },
  },
  "/api/revalidate": {
    post: {
      tags: ["Cache"],
      summary: "Revalidate Next.js cache tag",
      description:
        "Requires `secret` in JSON body matching env `REVALIDATE_SECRET`.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RevalidateRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Tag revalidated" },
        "400": { description: "Invalid tag" },
        "401": { description: "Invalid secret" },
      },
    },
  },
  "/api/media/presign": {
    post: {
      tags: ["Media"],
      summary: "Presign S3 upload URL",
      security: mediaSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/MediaPresignRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Presigned upload URL and metadata" },
        "400": { description: "Invalid kind or content type" },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/media/commit": {
    post: {
      tags: ["Media"],
      summary: "Commit CDN URLs to database",
      security: mediaSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/MediaCommitRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Per-commit results" },
        "400": { description: "commits[] required" },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/media/catalog": {
    post: {
      tags: ["Media"],
      summary: "List S3 object keys under prefix",
      security: mediaSecurity,
      requestBody: {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/MediaCatalogRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Object keys list" },
        "400": { description: "Invalid prefix" },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/media/hls/generate": {
    post: {
      tags: ["Media"],
      summary: "Start HLS transcode job",
      security: mediaSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/HlsGenerateRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Already done" },
        "202": { description: "Processing started" },
        "400": { description: "Invalid videoId or sourcePath" },
        "401": unauthorized["401"],
      },
    },
    get: {
      tags: ["Media"],
      summary: "Poll HLS job status",
      security: mediaSecurity,
      parameters: [
        {
          name: "videoId",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Job status and manifest when done" },
        "400": { description: "videoId required" },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/admin/content-import": {
    post: {
      tags: ["Admin"],
      summary: "Import pipeline artifacts (multipart upload)",
      description:
        "Upload clips and optional JSON artifacts as multipart/form-data. Use ?dryRun=1 for preview.",
      security: mediaSecurity,
      parameters: [
        {
          name: "dryRun",
          in: "query",
          schema: { type: "string", enum: ["1"] },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["episodeId", "clips"],
              properties: {
                episodeId: { type: "string" },
                mode: { type: "string", enum: ["insert", "replace"] },
                confirmReplace: { type: "string" },
                clips: { type: "string", format: "binary" },
                learningAnalysis: { type: "string", format: "binary" },
                translations: { type: "string", format: "binary" },
                vocabularySenses: { type: "string", format: "binary" },
                vocabularyOccurrences: { type: "string", format: "binary" },
                grammarOccurrences: { type: "string", format: "binary" },
                grammarCatalog: { type: "string", format: "binary" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Preview or import result",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ContentImportResponse" },
            },
          },
        },
        "400": { description: "Validation error" },
        "401": unauthorized["401"],
        "409": { description: "Duplicate DB row (e.g. part order)" },
        "413": { description: "Payload too large" },
      },
    },
  },
  "/api/admin/content-import/json": {
    post: {
      tags: ["Admin"],
      summary: "Import pipeline artifacts (JSON body)",
      description:
        "Same import engine as multipart content-import. Intended for lenra-content-pipeline publish. ?dryRun=1 for preview.",
      security: mediaSecurity,
      parameters: [
        {
          name: "dryRun",
          in: "query",
          schema: { type: "string", enum: ["1"] },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ContentImportJsonRequest" },
          },
        },
      },
      responses: {
        "200": {
          description: "Preview or import result",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ContentImportResponse" },
            },
          },
        },
        "400": { description: "Validation error" },
        "401": unauthorized["401"],
        "409": { description: "Duplicate DB row" },
        "413": { description: "Payload too large" },
      },
    },
  },
  "/api/admin/seed-catalog": {
    post: {
      tags: ["Admin"],
      summary: "Idempotently seed video/season/episode rows",
      security: mediaSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/SeedCatalogRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Catalog rows" },
        "400": { description: "Validation error" },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/admin/update-video-meta": {
    post: {
      tags: ["Admin"],
      summary: "Patch video metadata",
      security: mediaSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/UpdateVideoMetaRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Updated" },
        "400": { description: "No fields to update" },
        "401": unauthorized["401"],
        "404": { description: "Video not found" },
      },
    },
  },
  "/api/admin/cover-catalog": {
    get: {
      tags: ["Admin"],
      summary: "Seasons and episodes for cover admin",
      security: mediaSecurity,
      parameters: [
        {
          name: "videoId",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Seasons with nested episodes" },
        "400": { description: "videoId required" },
        "401": unauthorized["401"],
      },
    },
  },
  "/api/admin/update-cover": {
    post: {
      tags: ["Admin"],
      summary: "Update video/season/episode cover URL",
      security: mediaSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/UpdateCoverRequest" },
          },
        },
      },
      responses: {
        "200": { description: "Cover updated" },
        "400": { description: "Invalid target" },
        "401": unauthorized["401"],
        "404": { description: "Record not found" },
      },
    },
  },
  "/api/admin/upload-cover": {
    post: {
      tags: ["Admin"],
      summary: "Upload cover image to S3",
      security: mediaSecurity,
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file"],
              properties: {
                file: { type: "string", format: "binary" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Public CDN URL",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { url: { type: "string" } },
              },
            },
          },
        },
        "400": { description: "Invalid file" },
        "401": unauthorized["401"],
      },
    },
  },
};
