import type { Metadata } from "next";
import { AdminPage } from "@/components/admin-page";

export const metadata: Metadata = { title: "Painel Admin" };

export default async function Page({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  return <AdminPage initialSection={section} />;
}
