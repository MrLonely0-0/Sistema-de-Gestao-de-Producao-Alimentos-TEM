import type { Metadata } from "next";
import { ReportsPanel } from "@/components/reports-panel";

export const metadata: Metadata = { title: "Relatórios" };

export default function Page() {
  return <ReportsPanel />;
}
