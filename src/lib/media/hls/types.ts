export type HlsQualityLabel = "360p" | "720p";

export type HlsQualityPreset = {
  label: HlsQualityLabel;
  height: number;
  videoBitrate: string;
  audioBitrate: string;
  maxWidth: number;
};

export type HlsTranscodeOptions = {
  videoId: string;
  sourcePath: string;
  /** Segment length in seconds (2–4). Default 3. */
  segmentSeconds?: number;
  /** Override output root; default `public/media/hls`. */
  outputRoot?: string;
  onProgress?: (message: string) => void;
};

export type HlsTranscodeResult = {
  videoId: string;
  outputDir: string;
  masterPlaylistPath: string;
  masterPlaylistUrl: string;
  qualities: HlsQualityLabel[];
  segmentSeconds: number;
  /** Source duration in ms — same timeline as clean-clips `startMs`/`endMs`. */
  sourceDurationMs: number;
  fps: number;
};

export type HlsJobStatus = "processing" | "done" | "failed";

export type HlsJobRecord = {
  videoId: string;
  status: HlsJobStatus;
  sourcePath: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  hlsUrl?: string;
  error?: string;
  segmentSeconds: number;
};

export type PlaybackQualityInfo = {
  label: HlsQualityLabel;
  playlistUrl: string;
  bandwidth: number;
  width: number;
  height: number;
};

export type PlaybackManifest = {
  videoId: string;
  masterPlaylistUrl: string;
  qualities: PlaybackQualityInfo[];
  /** Target startup; master lists 720p first, ABR may switch to 360p. */
  estimatedStartupMs: number;
  segmentSeconds: number;
  sourceDurationMs: number | null;
  /**
   * Subtitle alignment: HLS `#EXTINF` timestamps are seconds from t=0 of the
   * source file — map `clean-clips.json` `startMs`/`endMs` directly (÷1000).
   */
  subtitleTimebase: {
    unit: "milliseconds";
    mediaOrigin: "source_start";
    hlsPresentation: "seconds_from_zero";
    aligned: true;
  };
  ready: boolean;
};
