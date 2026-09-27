import * as vq from "@/lib/db/queries/videos";
import { Video } from "@/types/video";
import { getStandaloneVideoWithParts } from "./parts";
import { getSeasonsWithEpisodes } from "./series";

export const getVideos = async (limit?: number): Promise<Video[]> => {
  return vq.listVideosLatestFirst(limit);
};

export const getVideoById = async (id: string) => {
  return vq.fetchVideoScalarsById(id);
};

export const getVideoWithContent = async (id: string) => {
  const video = await vq.fetchVideoScalarsById(id);

  if (!video) return null;

  if (video.type === "series") {
    return {
      ...video,
      seasons: await getSeasonsWithEpisodes(id),
    };
  }

  if (video.type === "movie" || video.type === "documentary") {
    return {
      ...video,
      parts: (await getStandaloneVideoWithParts(id))?.parts ?? [],
    };
  }

  return video;
};

export const createVideo = async (
  name: string,
  type: "series" | "movie" | "documentary",
  description?: string,
  releaseAt?: Date,
  coverUrl?: string,
) => {
  return vq.insertVideoScalars({
    name,
    type,
    description,
    releaseAt: releaseAt ?? new Date(),
    coverUrl,
  });
};

export const deleteVideoById = async (id: string) => {
  await vq.deleteVideoByPk(id);
};
