"use client";

import { usePathname } from "next/navigation";
import { TestnetBanner } from "@/components/app/testnet-banner";

/**
 * The testnet banner everywhere except the landing page, which says the same thing in its footer status line
 * ("Test networks only. No real money moves.") instead of a bar across the top.
 */
export function AppTestnetBanner({ isTestnet }: { isTestnet: boolean }) {
  const path = usePathname();
  return <TestnetBanner isTestnet={isTestnet && path !== "/"} />;
}
