"use client";

import { type ReactNode, createContext, useContext } from "react";
import { type LockupTone, type LogoFiles, LockupView } from "./lockup-view";

const NONE: LogoFiles = { bab: null, babOnDark: null, frax: null, fraxOnDark: null };
const LogosContext = createContext<LogoFiles>(NONE);

/** The server layout finds the logo files; client components read them from here. */
export function LogosProvider({ files, children }: { files: LogoFiles; children: ReactNode }) {
  return <LogosContext.Provider value={files}>{children}</LogosContext.Provider>;
}

export function useLogos(): LogoFiles {
  return useContext(LogosContext);
}

/** The lockup for client components. Size it with font-size on a parent. */
export function ClientLockup({ tone }: { tone?: LockupTone }) {
  return <LockupView files={useLogos()} tone={tone} />;
}
