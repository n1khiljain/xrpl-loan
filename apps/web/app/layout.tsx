import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { TestnetBanner } from "@/components/app/testnet-banner";
import { logoFiles } from "@/components/brand/lockup";
import { LogosProvider } from "@/components/brand/logos-context";
import { MotionRoot } from "@/components/motion";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { config, onTestnet } from "@/lib/config";
import { figtree, geistMono } from "@/lib/fonts";
import { AppProviders } from "@/lib/session/providers";
import "./globals.css";


export const metadata: Metadata = {
  title: "Get reimbursed now | Blockchain at Berkeley",
  description: "ASUC owes you money. Get it now from a lending vault on the XRP Ledger, and send it back when ASUC pays you.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  const logos = logoFiles();
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${figtree.variable} ${geistMono.variable}`}>
      <body className="flex min-h-screen flex-col">
          <TooltipProvider>
            <AppProviders>
              <LogosProvider files={logos}>
                <TestnetBanner isTestnet={onTestnet && config.features.testnetBanner} />
                <MotionRoot>
                  <AppShell logos={logos}>{children}</AppShell>
                </MotionRoot>
                <Toaster />
              </LogosProvider>
            </AppProviders>
          </TooltipProvider>
      </body>
    </html>
  );
}
