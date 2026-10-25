import { Geist_Mono, Inter, Inter_Tight } from "next/font/google";

// The landing's type: Inter Medium for headings and titles (its optical-size axis gives the Display cut at headline
// sizes, the closest free match to the identity's grotesk), Inter Light for body copy and interface text, Inter Tight
// for dollar figures, and Geist Mono for wallet addresses and transaction hashes.
export const inter = Inter({ subsets: ["latin"], weight: "variable", axes: ["opsz"], variable: "--font-inter", display: "swap" });
export const interTight = Inter_Tight({ subsets: ["latin"], weight: ["200", "300", "400", "500", "600"], variable: "--font-inter-tight", display: "swap" });
export const geistMono = Geist_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-geist-mono", display: "swap" });
