import type { PuzzlePart } from "@/types/puzzle";
import {
  puzzlePartsFromUiFinalSnapshot,
  type UiFinalSnapshot,
} from "./uiFinalSnapshot";

export type BuilderSessionMode = "idle" | "voice" | "drag";

export type BuilderSessionDerived = {
  activeTiles: PuzzlePart[];
  availableTiles: PuzzlePart[];
  /** True when the built line accepts tap-to-remove (drag mode only). */
  builtLineInteractive: boolean;
};

export type BuilderSessionState = {
  mode: BuilderSessionMode;
  voice: {
    snapshot: UiFinalSnapshot | null;
    version: number;
  };
  drag: {
    tiles: PuzzlePart[];
  };
  pool: PuzzlePart[];
  originalParts: PuzzlePart[];
  derived: BuilderSessionDerived;
};

export type DragAction =
  | { type: "add"; part: PuzzlePart }
  | { type: "remove"; index: number }
  | { type: "repair"; tiles: PuzzlePart[] };

export type BuilderSessionAction =
  | { type: "initClip"; pool: PuzzlePart[]; originalParts: PuzzlePart[]; speakThrough?: boolean }
  | { type: "startVoiceSession" }
  | { type: "voiceSnapshot"; snapshot: UiFinalSnapshot }
  | DragAction;

type SessionCore = Omit<BuilderSessionState, "derived">;

export function computeDerived(
  state: SessionCore,
): BuilderSessionDerived {
  let activeTiles: PuzzlePart[] = [];

  if (state.mode === "voice" && state.voice.snapshot) {
    activeTiles = puzzlePartsFromUiFinalSnapshot(
      state.voice.snapshot,
      state.pool,
      state.originalParts,
    );
  } else if (state.mode === "drag") {
    activeTiles = [...state.drag.tiles];
  }

  const placedIds = new Set(activeTiles.map((tile) => tile.id));
  const availableTiles = state.pool.filter((part) => !placedIds.has(part.id));

  return {
    activeTiles,
    availableTiles,
    builtLineInteractive: state.mode === "drag",
  };
}

function withDerived(state: SessionCore): BuilderSessionState {
  return { ...state, derived: computeDerived(state) };
}

export function createInitialBuilderSessionState(
  pool: PuzzlePart[],
  originalParts: PuzzlePart[],
  options?: { speakThrough?: boolean },
): BuilderSessionState {
  const speakThrough = options?.speakThrough ?? false;
  const core: SessionCore = {
    mode: speakThrough ? "drag" : "idle",
    voice: { snapshot: null, version: 0 },
    drag: { tiles: speakThrough ? [...originalParts] : [] },
    pool: [...pool],
    originalParts: [...originalParts],
  };
  return withDerived(core);
}

export function applyVoiceSnapshot(
  state: BuilderSessionState,
  snapshot: UiFinalSnapshot,
): BuilderSessionState {
  return withDerived({
    ...state,
    mode: "voice",
    voice: {
      snapshot,
      version: state.voice.version + 1,
    },
    drag: { tiles: [] },
  });
}

export function applyDragUpdate(
  state: BuilderSessionState,
  action: DragAction,
): BuilderSessionState {
  const clearedVoice: SessionCore["voice"] = {
    snapshot: null,
    version: state.voice.version,
  };

  switch (action.type) {
    case "add": {
      const baseTiles = state.mode === "voice" ? [] : state.drag.tiles;
      return withDerived({
        ...state,
        mode: "drag",
        voice: clearedVoice,
        drag: { tiles: [...baseTiles, action.part] },
      });
    }
    case "remove":
      return withDerived({
        ...state,
        mode: "drag",
        voice: clearedVoice,
        drag: {
          tiles: state.drag.tiles.filter((_, index) => index !== action.index),
        },
      });
    case "repair":
      return withDerived({
        ...state,
        mode: "drag",
        voice: clearedVoice,
        drag: { tiles: [...action.tiles] },
      });
  }
}

export function applyStartVoiceSession(
  state: BuilderSessionState,
): BuilderSessionState {
  return withDerived({
    ...state,
    mode: "idle",
    voice: { snapshot: null, version: state.voice.version },
    drag: { tiles: [] },
  });
}

export function reduceBuilderSession(
  state: BuilderSessionState,
  action: BuilderSessionAction,
): BuilderSessionState {
  switch (action.type) {
    case "initClip":
      return createInitialBuilderSessionState(action.pool, action.originalParts, {
        speakThrough: action.speakThrough,
      });
    case "startVoiceSession":
      return applyStartVoiceSession(state);
    case "voiceSnapshot":
      return applyVoiceSnapshot(state, action.snapshot);
    case "add":
    case "remove":
    case "repair":
      return applyDragUpdate(state, action);
  }
}

export type SessionIntegrityResult =
  | { valid: true }
  | { valid: false; reason: string };

function activeTileIds(parts: readonly PuzzlePart[]): string[] {
  return parts.map((part) => part.id);
}

function idsMatchInOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Render-authority guard. The voice snapshot is built solely from the placement
 * owner's output, so `derived` (rendered) must equal the snapshot's accepted set.
 */
export function validateSessionIntegrity(
  state: BuilderSessionState,
): SessionIntegrityResult {
  const { derived, pool, mode, voice, drag, originalParts } = state;
  const activeIds = activeTileIds(derived.activeTiles);

  if (new Set(activeIds).size !== activeIds.length) {
    return { valid: false, reason: "duplicate active tile ids" };
  }

  const placedIds = new Set(activeIds);
  const expectedAvailable = pool.filter((part) => !placedIds.has(part.id));
  const expectedAvailableIds = activeTileIds(expectedAvailable);
  const availableIds = activeTileIds(derived.availableTiles);
  if (!idsMatchInOrder(availableIds, expectedAvailableIds)) {
    return { valid: false, reason: "availableTiles not derived from pool - activeTiles" };
  }

  const recomputed = computeDerived({
    mode,
    voice,
    drag,
    pool,
    originalParts,
  });
  if (
    !idsMatchInOrder(activeTileIds(recomputed.activeTiles), activeIds) ||
    !idsMatchInOrder(activeTileIds(recomputed.availableTiles), availableIds) ||
    recomputed.builtLineInteractive !== derived.builtLineInteractive
  ) {
    return { valid: false, reason: "derived does not match computeDerived()" };
  }

  const poolIds = new Set(pool.map((part) => part.id));
  const originalIds = new Set(originalParts.map((part) => part.id));
  for (const id of activeIds) {
    if (!poolIds.has(id) && !originalIds.has(id)) {
      return { valid: false, reason: `ghost tile outside pool: ${id}` };
    }
  }

  if (mode === "voice") {
    if (!voice.snapshot) {
      return { valid: false, reason: "voice mode without snapshot" };
    }
    if (drag.tiles.length > 0) {
      return { valid: false, reason: "drag tiles present during voice mode" };
    }

    const snapshotOrder = voice.snapshot.orderedTiles.map((tile) => tile.id);
    if (!idsMatchInOrder(activeIds, snapshotOrder)) {
      return { valid: false, reason: "activeTiles mismatch voice snapshot order" };
    }

    if (voice.snapshot.acceptedTiles.length !== voice.snapshot.orderedTiles.length) {
      return {
        valid: false,
        reason: "acceptedTiles count mismatch snapshot orderedTiles count",
      };
    }

    if (voice.snapshot.orderedTiles.length !== activeIds.length) {
      return {
        valid: false,
        reason: "orderedTiles count mismatch derived activeTiles count",
      };
    }

    const acceptedIds = new Set(voice.snapshot.acceptedTiles.map((tile) => tile.id));
    for (const id of activeIds) {
      if (!acceptedIds.has(id)) {
        return {
          valid: false,
          reason: `rendered tile not in placement-accepted set: ${id}`,
        };
      }
    }
  } else if (mode === "drag") {
    if (voice.snapshot !== null) {
      return { valid: false, reason: "voice snapshot present during drag mode" };
    }
    if (!idsMatchInOrder(activeIds, activeTileIds(drag.tiles))) {
      return { valid: false, reason: "activeTiles mismatch drag.tiles" };
    }
  } else if (mode === "idle") {
    if (activeIds.length > 0) {
      return { valid: false, reason: "active tiles present in idle mode" };
    }
    if (voice.snapshot !== null) {
      return { valid: false, reason: "voice snapshot present in idle mode" };
    }
  }

  return { valid: true };
}

const IS_DEV = process.env.NODE_ENV !== "production";

export function assertDevSessionIntegrity(state: BuilderSessionState): void {
  if (!IS_DEV) return;

  console.assert(
    (state as BuilderSessionState & { uiFinalSnapshot?: unknown }).uiFinalSnapshot ===
      undefined,
    "uiFinalSnapshot must not exist in LOCK PHASE",
  );
  console.assert(
    new Set(state.derived.activeTiles.map((tile) => tile.id)).size ===
      state.derived.activeTiles.length,
    "Duplicate tiles detected",
  );
}
