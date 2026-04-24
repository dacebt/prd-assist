interface Props {
  agentRole: string;
}

export default function ThinkingRow({ agentRole }: Props) {
  return (
    <div className="flex mb-3 justify-start">
      <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm italic text-gray-400 dark:text-gray-500">
        {agentRole} is thinking…
      </div>
    </div>
  );
}
