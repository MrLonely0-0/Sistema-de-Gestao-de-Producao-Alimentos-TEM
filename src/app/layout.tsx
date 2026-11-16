import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import { getBrandingInfo, getSplashImageData } from "@/lib/branding";
import { SplashProvider } from "@/components/splash-provider";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBrandingInfo();
  return {
    title: {
      default: "Alimentos TEM · Produção e Logística",
      template: "%s · Alimentos TEM",
    },
    description: "Painel Kanban de produção, qualidade, acabamento e estoque da Alimentos TEM.",
    ...(branding ? {
      icons: {
        icon: [
          { url: branding.icon16Url, type: "image/png", sizes: "16x16" },
          { url: branding.icon32Url, type: "image/png", sizes: "32x32" },
        ],
        shortcut: { url: branding.icon32Url, type: "image/png" },
        apple: { url: branding.appleUrl, type: "image/png", sizes: "180x180" },
      },
    } : {}),
  };
}

export const viewport: Viewport = {
  themeColor: "#191b18",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [branding, imageDataUrl] = await Promise.all([getBrandingInfo(), getSplashImageData()]);
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        <SplashProvider branding={branding} imageDataUrl={imageDataUrl}>{children}</SplashProvider>
      </body>
    </html>
  );
}
