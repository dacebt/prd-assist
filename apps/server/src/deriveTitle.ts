export function deriveTitle(userText: string): string {
  if (userText.length === 0) return "";

  const collapsed = userText.replace(/\s+/g, " ").trim();

  if (collapsed.length <= 60) return collapsed;

  const cut = collapsed.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");

  if (lastSpace <= 0) return cut;

  return cut.slice(0, lastSpace).trimEnd();
}
