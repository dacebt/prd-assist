import type { Session } from "../../../shared/types.js";

interface Props {
  session: Session;
}

export default function ChatPane(_props: Props) {
  return (
    <div className="w-[400px] shrink-0 border-r border-gray-200 bg-white flex items-center justify-center">
      <p className="text-sm text-gray-400 italic">Chat coming in slice 3</p>
    </div>
  );
}
