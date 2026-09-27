/** Fire-and-forget work after sending the HTTP response (Next.js `after()` has no equivalent on lenra-api). */
export function runAfterResponse(task: () => void | Promise<void>): void {
  void Promise.resolve()
    .then(task)
    .catch((err) => {
      console.error("[runAfterResponse]", err);
    });
}
