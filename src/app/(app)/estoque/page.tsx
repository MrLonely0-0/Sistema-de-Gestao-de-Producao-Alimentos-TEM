import type { Metadata } from "next";
import { StockManager } from "@/components/stock-manager";

export const metadata: Metadata = { title: "Gestão de estoque" };

export default function Page() {
  return <StockManager />;
}
