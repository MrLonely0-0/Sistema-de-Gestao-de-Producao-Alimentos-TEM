import type { Metadata } from "next";
import { ChatPanel } from "@/components/chat-panel";
export const metadata: Metadata = { title: "Conversa" };
export default function Page() { return <ChatPanel />; }
