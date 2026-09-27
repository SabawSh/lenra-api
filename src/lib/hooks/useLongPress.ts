"use client";

import { useCallback, useRef } from "react";

const DEFAULT_DELAY_MS = 450;
const MOVE_TOLERANCE_PX = 12;

type Options = {
  onClick?: () => void;
  onLongPress?: () => void;
  delayMs?: number;
  disabled?: boolean;
};

export function useLongPress({
  onClick,
  onLongPress,
  delayMs = DEFAULT_DELAY_MS,
  disabled = false,
}: Options) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (disabled) return;
      longPressTriggeredRef.current = false;
      startPointRef.current = { x: event.clientX, y: event.clientY };

      if (!onLongPress) return;

      clearTimer();
      timerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        onLongPress();
      }, delayMs);
    },
    [clearTimer, delayMs, disabled, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!startPointRef.current || !timerRef.current) return;
      const dx = Math.abs(event.clientX - startPointRef.current.x);
      const dy = Math.abs(event.clientY - startPointRef.current.y);
      if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
        clearTimer();
      }
    },
    [clearTimer],
  );

  const onPointerUp = useCallback(() => {
    clearTimer();
    if (!longPressTriggeredRef.current && onClick) {
      onClick();
    }
    startPointRef.current = null;
  }, [clearTimer, onClick]);

  const onPointerCancel = useCallback(() => {
    clearTimer();
    startPointRef.current = null;
  }, [clearTimer]);

  const onContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (disabled || !onLongPress) return;
      event.preventDefault();
      onLongPress();
    },
    [disabled, onLongPress],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onContextMenu,
  };
}
