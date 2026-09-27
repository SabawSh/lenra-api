import * as videoQueries from "@/lib/db/queries/videos";
import {
  partInSectionFromOrder,
  sectionIndexFromOrder,
} from "@/lib/learning/sections";

export async function resolveMovieEntryRedirect(
  id: string,
  order: string | undefined,
) {
  const movie = await videoQueries.loadStandaloneVideoWithParts(id);
  if (!movie || (movie.type !== "movie" && movie.type !== "documentary")) {
    return { ok: false as const };
  }
  const learnType = movie.type === "documentary" ? "documentary" : "movie";

  if (order && !isNaN(+order) && +order >= 1) {
    const s = sectionIndexFromOrder(+order);
    const p = partInSectionFromOrder(+order);
    return {
      ok: true as const,
      redirect: {
        pathname: `/learn/${learnType}/${id}/section/${s}`,
        query: { part: String(p) },
      },
    };
  }

  return {
    ok: true as const,
    redirect: { pathname: `/movies/${id}/sections` },
  };
}
