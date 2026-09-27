import { getPartByOrder } from "@/lib/db/parts";
import { getSeasonWithEpisodes } from "@/lib/db/series";
import {
  partInSectionFromOrder,
  sectionIndexFromOrder,
} from "@/lib/learning/sections";

export async function resolveEpisodeLegacyEntry(
  id: string,
  seasonId: string,
  episodeId: string,
  order: string | undefined,
) {
  const video = await getSeasonWithEpisodes(id, seasonId);
  if (!video) {
    return { ok: false as const, reason: "not_found" as const };
  }

  if (order && !isNaN(+order) && +order >= 1) {
    const episodePart = await getPartByOrder({
      episodeId,
      order: +order,
    });
    if (!episodePart) {
      return { ok: false as const, reason: "part_not_found" as const };
    }
    const s = sectionIndexFromOrder(+order);
    const p = partInSectionFromOrder(+order);
    return {
      ok: true as const,
      redirect: {
        pathname: `/learn/series/${id}/${seasonId}/${episodeId}/section/${s}`,
        query: { part: String(p) },
      },
    };
  }

  return {
    ok: true as const,
    redirect: {
      pathname: `/series/${id}/${seasonId}/${episodeId}/sections`,
    },
  };
}
