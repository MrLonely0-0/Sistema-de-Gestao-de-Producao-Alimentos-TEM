import type { Metadata } from "next";
import { ChatPanel } from "@/components/chat-panel";

export const metadata: Metadata = { title: "Chat da equipe" };

export default function Page() {
  return <ChatPanel />;
}
