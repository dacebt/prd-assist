import { useEffect, useState } from "react";

export const SIDEBAR_MIN = 200;
export const CHAT_MIN = 320;
export const PRD_MIN = 320;

const SIDEBAR_DEFAULT = 256;
const CHAT_DEFAULT = 400;

const STORAGE_KEY = "prd-assist:panel-layout";

interface StoredLayout {
  sidebarWidth: number;
  chatWidth: number;
  prdOpen: boolean;
}

export interface PanelLayout {
  sidebarWidth: number;
  chatWidth: number;
  prdOpen: boolean;
  setSidebarWidth: (n: number) => void;
  setChatWidth: (n: number) => void;
  togglePrd: () => void;
}

function clamp(value: number, min: number): number {
  return value < min ? min : value;
}

function readStored(): StoredLayout {
  const fallback: StoredLayout = {
    sidebarWidth: SIDEBAR_DEFAULT,
    chatWidth: CHAT_DEFAULT,
    prdOpen: true,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredLayout>;
    return {
      sidebarWidth: clamp(
        typeof parsed.sidebarWidth === "number" ? parsed.sidebarWidth : SIDEBAR_DEFAULT,
        SIDEBAR_MIN,
      ),
      chatWidth: clamp(
        typeof parsed.chatWidth === "number" ? parsed.chatWidth : CHAT_DEFAULT,
        CHAT_MIN,
      ),
      prdOpen: typeof parsed.prdOpen === "boolean" ? parsed.prdOpen : true,
    };
  } catch {
    return fallback;
  }
}

export function usePanelLayout(): PanelLayout {
  const [layout, setLayout] = useState<StoredLayout>(readStored);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  return {
    sidebarWidth: layout.sidebarWidth,
    chatWidth: layout.chatWidth,
    prdOpen: layout.prdOpen,
    setSidebarWidth: (n) => setLayout((prev) => ({ ...prev, sidebarWidth: clamp(n, SIDEBAR_MIN) })),
    setChatWidth: (n) => setLayout((prev) => ({ ...prev, chatWidth: clamp(n, CHAT_MIN) })),
    togglePrd: () => setLayout((prev) => ({ ...prev, prdOpen: !prev.prdOpen })),
  };
}
