export const saveLearningTimeDelta = async (learningTimeMs: number) => {
  if (!Number.isFinite(learningTimeMs) || learningTimeMs <= 0) return;

  await fetch("/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ learningTimeMs: Math.round(learningTimeMs) }),
  });
};
