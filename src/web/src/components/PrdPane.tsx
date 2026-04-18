import type { PRD } from "../../../shared/types.js";
import { SECTION_KEYS } from "../../../shared/sections.js";
import SectionBlock from "./SectionBlock.js";

interface Props {
  prd: PRD;
}

export default function PrdPane({ prd }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h2 className="text-lg font-bold text-gray-700 mb-4">PRD</h2>
      {SECTION_KEYS.map((key) => (
        <SectionBlock key={key} sectionKey={key} section={prd[key]} />
      ))}
    </div>
  );
}
