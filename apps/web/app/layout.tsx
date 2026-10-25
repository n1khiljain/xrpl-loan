import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { AppTestnetBanner } from "@/components/app/app-testnet-banner";
import { DemoAsSwitch } from "@/components/app/local-demo-picker";
import { logoFiles } from "@/components/brand/lockup";
import { LogosProvider } from "@/components/brand/logos-context";
import { MotionRoot } from "@/components/motion";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { config, onTestnet } from "@/lib/config";
import { geistMono, inter, interTight } from "@/lib/fonts";
import { AppProviders } from "@/lib/session/providers";
import "./globals.css";


export const metadata: Metadata = {
  title: "Install",
  description: "Expedite a transaction, transfer, or payment with an upfront loan. Pay it back with interest based on the loan horizon.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  const logos = logoFiles();
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${inter.variable} ${interTight.variable} ${geistMono.variable}`}>
      <body className="flex min-h-screen flex-col">
          <TooltipProvider>
            <AppProviders>
              <DemoAsSwitch />
              <LogosProvider files={logos}>
                <AppTestnetBanner isTestnet={onTestnet && config.features.testnetBanner} />
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
