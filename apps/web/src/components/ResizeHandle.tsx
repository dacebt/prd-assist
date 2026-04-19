import { useRef } from "react";

interface Props {
  onResize: (deltaPx: number) => void;
  ariaLabel: string;
}

export default function ResizeHandle({ onResize, ariaLabel }: Props) {
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

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className="w-1 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 active:bg-blue-500 dark:bg-gray-800 dark:hover:bg-blue-500"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}
