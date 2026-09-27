export type ReviewQueueItem = {
  partId: string;
  sectionIndex: number;
  partInSection: number;
};

export type EpisodeReviewQueueState = {
  episodeId: string;
  /** Where to send the learner when the queue is finished (episode sections list). */
  returnPath: string;
  items: ReviewQueueItem[];
  reviewedPartIds: string[];
};

const STORAGE_KEY = "lenra_episode_review_queue";

function readAll(): Record<string, EpisodeReviewQueueState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, EpisodeReviewQueueState>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, EpisodeReviewQueueState>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

export function seedEpisodeReviewQueue(state: EpisodeReviewQueueState) {
  const all = readAll();
  all[state.episodeId] = {
    ...state,
    reviewedPartIds: [...state.reviewedPartIds],
  };
  writeAll(all);
}

export function loadEpisodeReviewQueue(
  episodeId: string,
): EpisodeReviewQueueState | null {
  const state = readAll()[episodeId];
  if (!state?.items?.length) return null;
  return state;
}

export function markReviewedAndPeekNext(
  episodeId: string,
  completedPartId: string,
): { next: ReviewQueueItem | null; state: EpisodeReviewQueueState } | null {
  const state = loadEpisodeReviewQueue(episodeId);
  if (!state) return null;

  const reviewed = new Set(state.reviewedPartIds);
  reviewed.add(completedPartId);

  const next = state.items.find((item) => !reviewed.has(item.partId)) ?? null;

  const updated: EpisodeReviewQueueState = {
    ...state,
    reviewedPartIds: [...reviewed],
  };

  const all = readAll();
  if (next) {
    all[episodeId] = updated;
    writeAll(all);
  } else {
    delete all[episodeId];
    writeAll(all);
  }

  return { next, state: updated };
}

export function clearEpisodeReviewQueue(episodeId: string) {
  const all = readAll();
  delete all[episodeId];
  writeAll(all);
}

export function reviewProgress(state: EpisodeReviewQueueState) {
  const total = state.items.length;
  const done = state.reviewedPartIds.length;
  const current = Math.min(done + 1, total);
  return { current, total, done };
}

/** Session storage key for spaced-repetition queues (episode id or `video:{id}`). */
export function reviewQueueScopeId(params: {
  videoId: string;
  episodeId?: string | null;
}): string {
  return params.episodeId?.trim() ? params.episodeId : `video:${params.videoId}`;
}

export function appendReviewQuery(href: string): string {
  if (typeof window === "undefined") return href;
  const url = new URL(href, window.location.origin);
  url.searchParams.set("review", "1");
  url.searchParams.set("autoplay", "1");
  return url.pathname + url.search;
}
