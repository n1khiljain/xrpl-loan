import { Figtree, Geist_Mono } from "next/font/google";

// The landing page's type, used everywhere since the landing became the source of truth: Figtree for text and
// headings, Geist Mono only for wallet addresses and transaction hashes
export const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-figtree", display: "swap" });
export const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });
