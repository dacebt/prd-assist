import type { PRD } from "../../../shared/types.js";
import { SECTION_KEYS } from "../../../shared/sections.js";
import SectionBlock from "./SectionBlock.js";

interface Props {
  prd: PRD;
  onClose: () => void;
}

export default function PrdPane({ prd, onClose }: Props) {
  return (
    <div className="h-full w-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-700 dark:text-gray-200">PRD</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close PRD panel"
          className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          ✕
        </button>
      </div>
      {SECTION_KEYS.map((key) => (
        <SectionBlock key={key} sectionKey={key} section={prd[key]} />
      ))}
    </div>
  );
}
