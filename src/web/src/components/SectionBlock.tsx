import type { Section, SectionKey } from "../../../shared/types.js";
import { SECTION_LABELS } from "../../../shared/sections.js";

const STATUS_PILL: Record<Section["status"], string> = {
  empty: "bg-gray-100 text-gray-500",
  draft: "bg-yellow-100 text-yellow-700",
  confirmed: "bg-green-100 text-green-700",
};

interface Props {
  sectionKey: SectionKey;
  section: Section;
}

export default function SectionBlock({ sectionKey, section }: Props) {
  const label = SECTION_LABELS[sectionKey];
  const pillClass = STATUS_PILL[section.status];

  return (
    <div className="mb-4 rounded border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-semibold text-gray-800">{label}</h3>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${pillClass}`}>
          {section.status}
        </span>
      </div>
      {section.content ? (
        <pre className="whitespace-pre-wrap text-sm text-gray-700">{section.content}</pre>
      ) : (
        <p className="text-sm text-gray-400 italic">(empty)</p>
      )}
    </div>
  );
}
