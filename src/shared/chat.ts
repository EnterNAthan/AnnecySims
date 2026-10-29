export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ResidentChat {
  id: number;
  name: string;
  messages: ChatMessage[];
  busy: boolean;
  error?: string;
}
