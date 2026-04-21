export type SectionKey =
  | "vision"
  | "problem"
  | "targetUsers"
  | "goals"
  | "coreFeatures"
  | "outOfScope"
  | "openQuestions";

export type SectionStatus = "empty" | "draft" | "confirmed";

export type Section = {
  content: string;
  updatedAt: string;
  status: SectionStatus;
};

export type PRD = Record<SectionKey, Section>;

export type ChatMessageUser = { role: "user"; content: string; at: string };
export type ChatMessageAssistant = {
  role: "assistant";
  content: string;
  at: string;
};
export type ChatMessage = ChatMessageUser | ChatMessageAssistant;

export type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  prd: PRD;
};

export type SessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  exchangeCount: number;
  sectionsConfirmed: number;
};
