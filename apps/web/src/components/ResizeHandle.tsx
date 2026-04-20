import { useRef } from "react";

interface Props {
  onResize: (deltaPx: number) => void;
  ariaLabel: string;
  valueNow: number;
  valueMin: number;
  valueMax: number;
}

function keyboardDelta(
  e: React.KeyboardEvent<HTMLDivElement>,
  valueNow: number,
  valueMin: number,
  valueMax: number,
): number | null {
  if (e.key === "ArrowLeft") return e.shiftKey ? -64 : -16;
  if (e.key === "ArrowRight") return e.shiftKey ? 64 : 16;
  if (e.key === "Home") return valueMin - valueNow;
  if (e.key === "End") return valueMax - valueNow;
  return null;
}

export default function ResizeHandle({ onResize, ariaLabel, valueNow, valueMin, valueMax }: Props) {
  const lastXRef = useRef<number | null>(null);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    lastXRef.current = e.clientX;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (lastXRef.current === null) return;
    const delta = e.clientX - lastXRef.current;
    if (delta === 0) return;
    lastXRef.current = e.clientX;
    onResize(delta);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    lastXRef.current = null;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const delta = keyboardDelta(e, valueNow, valueMin, valueMax);
    if (delta !== null) {
      e.preventDefault();
      onResize(delta);
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={valueNow}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      tabIndex={0}
      className="w-1 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 active:bg-blue-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 dark:bg-gray-800 dark:hover:bg-blue-500"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    />
  );
}
