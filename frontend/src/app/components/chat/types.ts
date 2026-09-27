export interface ConsentInfo {
  version: number;
  text: string;
}

export interface ChatMessage {
  sender: "user" | "agent";
  text: string;
}

export type Phase = "boot" | "gate" | "chat";
