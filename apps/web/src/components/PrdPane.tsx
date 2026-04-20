import type { PRD } from "@prd-assist/shared";
import { SECTION_KEYS } from "@prd-assist/shared";
import SectionBlock from "./SectionBlock";

interface Props {
  prd: PRD;
}

export default function PrdPane({ prd }: Props) {
  return (
    <div className="h-full w-full overflow-y-auto p-4">
      <h2 className="mb-4 text-lg font-bold text-gray-700 dark:text-gray-200">PRD</h2>
      {SECTION_KEYS.map((key) => (
        <SectionBlock key={key} sectionKey={key} section={prd[key]} />
      ))}
    </div>
  );
}
