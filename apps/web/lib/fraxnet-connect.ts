/**
 * Connect FraxNet (U-77). `fraxnet-connect` keeps the PKCE verifier and state on the server; the browser only
 * carries FraxNet's code back. FraxNet opens in a new tab, since someone new has to make an account and verify there
 * first, and the tab that finishes tells the others. If the browser blocks the tab, this tab goes instead, and the
 * page to come back to is remembered for this tab only.
 */
const RETURN_KEY = "fraxnet-connect:return";
const CHANNEL = "fraxnet-connect";

/** Only same-site paths, so a crafted link can't send someone off the app after they connect. */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}

export function rememberReturnPath(path: string): void {
  const safe = safeReturnPath(path);
  try {
    if (safe) sessionStorage.setItem(RETURN_KEY, safe);
    else sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // private windows can refuse storage; the callback then goes to /onboard/
  }
}

export function takeReturnPath(): string | null {
  try {
    const value = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return safeReturnPath(value);
  } catch {
    return null;
  }
}

type Call = <T>(name: string, options?: { method?: "POST"; body?: unknown }) => Promise<T>;

/**
 * Opens an empty tab for FraxNet. It has to happen in the click itself or the browser blocks it, before the server
 * has answered with the sign-in URL. Null when it was blocked.
 */
export function openFraxnetTab(): Window | null {
  // a tab opened from here starts with a copy of this tab's storage, so drop any return path it would inherit
  rememberReturnPath("");
  const tab = window.open("", "_blank");
  // FraxNet's pages don't get a handle back to this one
  if (tab) tab.opener = null;
  return tab;
}

/**
 * Asks the server for a FraxNet sign-in URL and sends `tab` there, or this tab when there isn't one. Returns where
 * FraxNet opened.
 */
export async function startFraxnetConnect(call: Call, returnTo: string, tab: Window | null = null): Promise<"tab" | "here"> {
  const { authorizeUrl } = await call<{ authorizeUrl: string }>("fraxnet-connect", { method: "POST", body: { action: "start" } });
  if (tab && !tab.closed) {
    tab.location.href = authorizeUrl;
    return "tab";
  }
  rememberReturnPath(returnTo);
  window.location.assign(authorizeUrl);
  return "here";
}

/** Tells this app's other tabs that FraxNet is connected, with what `fraxnet-connect` answered. */
export function announceConnected(status: unknown): void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(status);
    channel.close();
  } catch {
    // older browsers: the other tab checks again when it's focused
  }
}

/** Calls `onConnected` when another tab finishes connecting. Returns the unsubscribe. */
export function onConnected(listener: (status: unknown) => void): () => void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent) => listener(event.data);
    return () => channel.close();
  } catch {
    return () => {};
  }
}
