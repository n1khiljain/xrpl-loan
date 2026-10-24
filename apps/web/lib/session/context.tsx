"use client";

import { createContext, useContext } from "react";
import type { Session } from "./types";

const noop = async () => {};

export const SIGNED_OUT: Session = {
  kind: "none",
  status: "loading",
  userId: null,
  email: null,
  name: null,
  sendEmailCode: noop,
  verifyEmailCode: noop,
  loginWithGoogle: noop,
  loginError: null,
  logout: noop,
  getAccessToken: async () => null,
  getIdentityToken: async () => null,
  unavailableReason: null,
};

export const SessionContext = createContext<Session>(SIGNED_OUT);

export function useSession(): Session {
  return useContext(SessionContext);
}
