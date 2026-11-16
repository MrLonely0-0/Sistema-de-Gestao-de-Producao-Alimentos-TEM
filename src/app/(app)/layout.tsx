import type { ReactNode } from "react";
import { AppGate } from "@/components/auth-provider";
import { ToastProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AppGate>{children}</AppGate>
    </ToastProvider>
  );
}
