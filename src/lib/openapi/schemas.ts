/** Shared OpenAPI 3 component schemas for Lenra API routes. */

export const schemas = {
  ErrorResponse: {
    type: "object",
    properties: {
      error: { type: "string" },
      detail: { type: "string" },
    },
    required: ["error"],
  },
  OkResponse: {
    type: "object",
    properties: { ok: { type: "boolean", example: true } },
    required: ["ok"],
  },
  AuthUser: {
    type: "object",
    nullable: true,
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string", nullable: true },
      email: { type: "string", nullable: true },
      phone: { type: "string", nullable: true },
      avatarUrl: { type: "string", nullable: true },
    },
  },
  AuthMeResponse: {
    type: "object",
    properties: {
      user: { $ref: "#/components/schemas/AuthUser" },
    },
  },
  PhoneStartRequest: {
    type: "object",
    required: ["phone"],
    properties: {
      phone: { type: "string", description: "Iran mobile number" },
    },
  },
  PhoneStartResponse: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      phone: { type: "string" },
      expiresAt: { type: "string", format: "date-time" },
      debugCode: {
        type: "string",
        description: "Present in development when SMS is not sent",
      },
    },
  },
  PhoneVerifyRequest: {
    type: "object",
    required: ["phone", "code"],
    properties: {
      phone: { type: "string" },
      code: { type: "string", pattern: "^\\d{6}$" },
    },
  },
  PhoneVerifyResponse: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      user: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", nullable: true },
          phone: { type: "string", nullable: true },
        },
      },
      needsOnboarding: { type: "boolean" },
    },
  },
  OnboardingPatchRequest: {
    type: "object",
    properties: {
      username: { type: "string", pattern: "^[a-z0-9_]{3,30}$" },
      englishLevel: {
        type: "string",
        enum: [
          "beginner",
          "elementary",
          "intermediate",
          "upperIntermediate",
          "advanced",
        ],
      },
      contentPrefs: {
        type: "array",
        items: { type: "string" },
      },
      dailyGoalMinutes: { type: "integer", minimum: 1, maximum: 120 },
      complete: { type: "boolean" },
    },
  },
  UsernameCheckResponse: {
    type: "object",
    properties: {
      available: { type: "boolean" },
      error: { type: "string" },
    },
  },
  VocabularySaveRequest: {
    type: "object",
    required: ["clipId", "word"],
    properties: {
      clipId: { type: "string" },
      word: { type: "string" },
      sentence: { type: "string" },
      translation: { type: "string" },
    },
  },
  VocabularyReviewRequest: {
    type: "object",
    required: ["outcome"],
    properties: {
      outcome: {
        type: "string",
        enum: ["got-it", "almost", "need-practice"],
      },
    },
  },
  ReminderCreateRequest: {
    type: "object",
    required: ["partId", "dueAt"],
    properties: {
      partId: { type: "string" },
      dueAt: { type: "string", format: "date-time" },
    },
  },
  PerformanceRaw: {
    type: "object",
    properties: {
      unitId: { type: "string" },
      totalWords: { type: "integer" },
      correctWords: { type: "integer" },
      attemptedWords: { type: "integer" },
      wrongMoves: { type: "integer" },
      hintsUsed: { type: "integer" },
      videoDurationMs: { type: "integer" },
      inputMode: { type: "string", enum: ["drag", "voice"] },
      startedAt: { type: "number" },
      finishedAt: { type: "number" },
      attempts: { type: "integer" },
      challenge: {
        type: "object",
        properties: {
          clipDifficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          difficultyScore: { type: "number", nullable: true },
          speechRate: { type: "number", nullable: true },
          chunks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                text: { type: "string" },
                tokens: { type: "array", items: { type: "string" } },
                locked: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
  PerformanceRequest: {
    type: "object",
    required: ["partId", "performance", "raw"],
    properties: {
      partId: { type: "string" },
      performance: { type: "number" },
      raw: { $ref: "#/components/schemas/PerformanceRaw" },
    },
  },
  LearningTimeRequest: {
    type: "object",
    required: ["learningTimeMs"],
    properties: {
      learningTimeMs: { type: "number", minimum: 1 },
    },
  },
  XpAwardRequest: {
    type: "object",
    required: ["reason"],
    properties: {
      reason: {
        type: "string",
        enum: ["complete_clip"],
      },
      amount: {
        type: "number",
        minimum: 1,
        description: "XP to award (required for clip completion grants)",
      },
    },
  },
  VideoLikeRequest: {
    type: "object",
    properties: {
      isLiked: { type: "boolean", description: "Omit to toggle" },
    },
  },
  RevalidateRequest: {
    type: "object",
    required: ["secret", "tag"],
    properties: {
      secret: { type: "string" },
      tag: { type: "string", enum: ["episodes", "seasons", "videos"] },
    },
  },
  MediaPresignRequest: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["cover", "clip", "misc", "hls"],
        default: "misc",
      },
      filename: { type: "string" },
      relativeDirectory: { type: "string" },
      contentType: { type: "string" },
      contentTitle: { type: "string" },
      season: { type: "integer" },
      episode: { type: "integer" },
      part: { type: "integer" },
      publicRead: { type: "boolean", default: true },
      packageUuid: { type: "string" },
      localFolderName: { type: "string" },
      hlsRelativePath: { type: "string" },
      videoId: { type: "string" },
    },
  },
  MediaCommitRequest: {
    type: "object",
    required: ["commits"],
    properties: {
      commits: {
        type: "array",
        items: {
          type: "object",
          required: ["kind", "publicUrl", "contentTitle"],
          properties: {
            kind: { type: "string", enum: ["clip", "cover", "hls"] },
            publicUrl: { type: "string" },
            contentTitle: { type: "string" },
            season: { type: "integer" },
            episode: { type: "integer" },
            part: { type: "integer" },
          },
        },
      },
    },
  },
  MediaCatalogRequest: {
    type: "object",
    properties: {
      prefix: { type: "string", example: "clips/" },
      maxTotal: { type: "integer", maximum: 25000 },
    },
  },
  HlsGenerateRequest: {
    type: "object",
    required: ["videoId", "sourcePath"],
    properties: {
      videoId: { type: "string" },
      sourcePath: { type: "string" },
      segmentSeconds: { type: "integer", minimum: 2, maximum: 4 },
    },
  },
  SeedCatalogRequest: {
    type: "object",
    required: ["videoName"],
    properties: {
      videoName: { type: "string", maxLength: 191 },
      videoType: {
        type: "string",
        enum: ["series", "movie", "documentary"],
        default: "series",
      },
      seasonNum: { type: "integer", minimum: 1, maximum: 99 },
      episodeNum: { type: "integer", minimum: 1, maximum: 99 },
      episodeTitle: { type: "string" },
      releaseAt: { type: "string", format: "date-time" },
    },
  },
  UpdateVideoMetaRequest: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
      levels: { type: "array", items: { type: "string" } },
      level: { type: "string", nullable: true },
      genres: { type: "array", items: { type: "string" } },
      isNew: { type: "boolean" },
      imdbRating: { type: "number", minimum: 0, maximum: 10, nullable: true },
      isLiked: { type: "boolean" },
      releaseAt: { type: "string", format: "date-time" },
    },
  },
  UpdateCoverRequest: {
    type: "object",
    required: ["targetType", "id", "coverUrl"],
    properties: {
      targetType: {
        type: "string",
        enum: ["video", "season", "episode"],
      },
      id: { type: "string" },
      coverUrl: { type: "string" },
    },
  },
  EpisodeLastPositionBody: {
    type: "object",
    required: ["videoId", "seasonId", "sectionIndex", "partInSection"],
    properties: {
      videoId: { type: "string" },
      seasonId: { type: "string" },
      sectionIndex: { type: "integer", minimum: 1 },
      partInSection: { type: "integer", minimum: 1 },
    },
  },
  SectionClipBatchRequest: {
    type: "object",
    properties: {
      sectionIndices: {
        type: "array",
        items: { type: "integer" },
        maxItems: 36,
      },
    },
  },
  ContentImportJsonRequest: {
    type: "object",
    required: ["episodeId", "artifacts"],
    properties: {
      episodeId: { type: "string", format: "uuid" },
      mode: { type: "string", enum: ["insert", "replace"], default: "insert" },
      confirmReplace: { type: "boolean", default: false },
      artifacts: {
        type: "object",
        required: ["clips"],
        properties: {
          clips: { type: "object", description: "Pipeline clips.json document" },
          learningAnalysis: { type: "object" },
          translations: {},
          vocabularySenses: {},
          vocabularyOccurrences: {},
          grammarOccurrences: {},
          grammarCatalog: {},
        },
      },
    },
  },
  ContentImportResponse: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      stage: { type: "string", enum: ["preview", "imported", "validation", "import"] },
      result: { type: "object", description: "ContentRefreshResult on success" },
      error: { type: "string" },
      detail: { type: "string" },
      mysqlCode: { type: "string" },
    },
  },
} as const;
