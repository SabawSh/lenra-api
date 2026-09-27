import { spawn } from "node:child_process";

export type VideoProbe = {
  durationMs: number;
  fps: number;
  width: number;
  height: number;
};

function parseFrameRate(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 24;
  if (trimmed.includes("/")) {
    const [num, den] = trimmed.split("/").map((v) => Number.parseFloat(v));
    if (num && den) return num / den;
  }
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) && n > 0 ? n : 24;
}

function runFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      reject(new Error(`ffprobe failed to start: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffprobe exited with code ${code}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Probes the source file. Duration matches wall-clock used by subtitle `startMs`/`endMs`.
 */
export async function probeVideo(sourcePath: string): Promise<VideoProbe> {
  const formatOut = await runFfprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    sourcePath,
  ]);

  const streamOut = await runFfprobe([
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate",
    "-of",
    "csv=p=0:s=x",
    sourcePath,
  ]);

  const durationSec = Number.parseFloat(formatOut.split("\n")[0] ?? "");
  const [widthRaw, heightRaw, fpsRaw] = streamOut.split("x");

  const width = Number.parseInt(widthRaw ?? "", 10) || 0;
  const height = Number.parseInt(heightRaw ?? "", 10) || 0;
  const fps = parseFrameRate(fpsRaw ?? "24");

  return {
    durationMs: Number.isFinite(durationSec)
      ? Math.round(durationSec * 1000)
      : 0,
    fps,
    width,
    height,
  };
}
