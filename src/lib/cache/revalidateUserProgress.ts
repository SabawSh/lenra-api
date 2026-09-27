import { revalidateTag } from "next/cache";

/** Bust caches that depend on per-user clip progress (section unlock, summaries). */
export function revalidateUserProgressTags(): void {
  revalidateTag("user-progress", { expire: 0 });
  revalidateTag("user", { expire: 0 });
  revalidateTag("episodes", { expire: 0 });
  revalidateTag("videos", { expire: 0 });
}
