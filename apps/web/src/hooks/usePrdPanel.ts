import { useEffect, useState } from "react";

export const PRD_MIN = 320;
export const CHAT_MIN = 320;
export const NARROW_VIEWPORT_PX = 720;

const STORAGE_KEY = "prd-assist:prd-panel";
const LEGACY_KEY = "prd-assist:panel-layout";
const WIDTH_DEFAULT = 480;

interface StoredPanel {
  open: boolean;
  width: number;
}

export interface PrdPanel {
  open: boolean;
  width: number;
  canOpen: boolean;
  toggle: () => void;
  setWidth: (n: number) => void;
  maxWidth: number;
}

function computeMaxWidth(): number {
  return Math.max(PRD_MIN, window.innerWidth - CHAT_MIN);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function readStored(): StoredPanel {
  // One-time migration: clear the old three-field key so it doesn't occupy stale space.
  localStorage.removeItem(LEGACY_KEY);

  const fallback: StoredPanel = { open: false, width: WIDTH_DEFAULT };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredPanel>;
    const width = clamp(
      typeof parsed.width === "number" ? parsed.width : WIDTH_DEFAULT,
      PRD_MIN,
      computeMaxWidth(),
    );
    return {
      open: typeof parsed.open === "boolean" ? parsed.open : false,
      width,
    };
  } catch {
    return fallback;
  }
}

export function usePrdPanel(): PrdPanel {
  const [stored, setStored] = useState<StoredPanel>(readStored);
  const [canOpen, setCanOpen] = useState<boolean>(() => window.innerWidth >= NARROW_VIEWPORT_PX);
  const [maxWidth, setMaxWidth] = useState<number>(computeMaxWidth);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }, [stored]);

  useEffect(() => {
    function handleResize() {
      const nextMax = computeMaxWidth();
      const nextCanOpen = window.innerWidth >= NARROW_VIEWPORT_PX;
      setMaxWidth(nextMax);
      setCanOpen(nextCanOpen);
      // Re-clamp stored width without touching the persisted open preference.
      setStored((prev) =>
        prev.width > nextMax ? { ...prev, width: nextMax } : prev,
      );
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return {
    open: stored.open && canOpen,
    width: stored.width,
    canOpen,
    maxWidth,
    toggle: () => setStored((prev) => ({ ...prev, open: !prev.open })),
    setWidth: (n) =>
      setStored((prev) => ({
        ...prev,
        width: clamp(n, PRD_MIN, computeMaxWidth()),
      })),
  };
}
