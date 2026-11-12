import type { Metadata } from "next";
import { BoardPage } from "@/components/board-page";

export const metadata: Metadata = { title: "Painel de produção" };

export default function Page() {
  return <BoardPage />;
}
