import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Alimentos TEM · Produção e Logística",
    template: "%s · Alimentos TEM",
  },
  description: "Painel Kanban de produção, qualidade, acabamento e estoque da Alimentos TEM.",
};

export const viewport: Viewport = {
  themeColor: "#191b18",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
