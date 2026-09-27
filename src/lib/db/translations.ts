import * as vq from "@/lib/db/queries/videos";

export const getCaptionTranslation = async (
  partId: string,
  language: string,
) => {
  return vq.findCaptionTranslation(partId, language);
};

export const saveCaptionTranslation = async (
  partId: string,
  language: string,
  text: string,
  provider?: string,
) => {
  await vq.upsertCaptionTranslation({
    partId,
    language,
    text,
    provider,
  });
  return getCaptionTranslation(partId, language);
};
