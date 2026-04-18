import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Section, SectionKey } from "../../../shared/types.js";
import { SECTION_LABELS } from "../../../shared/sections.js";

const STATUS_PILL: Record<Section["status"], string> = {
  empty: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  draft: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  confirmed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

interface Props {
  sectionKey: SectionKey;
  section: Section;
}

export default function SectionBlock({ sectionKey, section }: Props) {
  const label = SECTION_LABELS[sectionKey];
  const pillClass = STATUS_PILL[section.status];

  return (
    <div className="mb-4 rounded border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100">{label}</h3>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${pillClass}`}>
          {section.status}
        </span>
      </div>
      {section.content ? (
        <div className="text-sm text-gray-700 prose prose-sm max-w-none dark:text-gray-200 dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.content}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic dark:text-gray-500">(empty)</p>
      )}
    </div>
  );
}
