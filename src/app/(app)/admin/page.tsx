import type { Metadata } from "next";
import { AdminPage } from "@/components/admin-page";

export const metadata: Metadata = { title: "Painel Admin" };

export default function Page() {
  return <AdminPage />;
}
