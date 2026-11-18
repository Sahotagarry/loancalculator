type Identity = { tenantId: string; objectId: string };
export type SessionState = "checking" | "ready" | "expired" | "unavailable" | "denied" | "changed";
let state: SessionState = "checking";
let identity: Identity | undefined;
let recovery: Promise<boolean> | undefined;
const listeners = new Set<() => void>();
export const sessionSnapshot = () => state;
export const subscribeSession = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function setState(value: SessionState) { state = value; listeners.forEach(fn => fn()); }
const originalFetch = window.fetch.bind(window);
const base = import.meta.env.BASE_URL.replace(/\/$/, "");
let generation = 0;
let lastRenewal = 0;
let renewalAllowed = true;
export const verifiedIdentityEvent = "loan-session-verified";

export function verifySession(renew = false): Promise<boolean> {
  if (state === "changed" || state === "denied") return Promise.resolve(false);
  if (recovery) return recovery;
  const currentGeneration = generation;
  recovery = (async () => {
    try {
      const renewToken = async () => {
        if (!renewalAllowed && Date.now() - lastRenewal < 30000) return;
        renewalAllowed = false;
        lastRenewal = Date.now();
        await originalFetch("/.auth/refresh", { credentials: "same-origin", signal: AbortSignal.timeout(15000) });
      };
      if (renew) await renewToken();
      let response = await originalFetch(`${base}/api/auth/me`, {
        credentials: "same-origin", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000),
      });
      if (response.status === 401 && !renew) {
        await renewToken();
        response = await originalFetch(`${base}/api/auth/me`, { credentials: "same-origin", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
      }
      if (generation !== currentGeneration) return false;
      if (!response.ok) {
        setState(response.status === 401 ? "expired" : response.status === 403 ? "denied" : "unavailable");
        return false;
      }
      const next: Identity = await response.json();
      if (!next.tenantId || !next.objectId) throw new Error("Invalid identity response");
      if (identity && (identity.tenantId !== next.tenantId || identity.objectId !== next.objectId)) {
        setState("changed"); return false;
      }
      identity = next;
      document.dispatchEvent(new CustomEvent(verifiedIdentityEvent, { detail: next }));
      setState("ready");
      return true;
    } catch {
      if (generation === currentGeneration) setState("unavailable");
      return false;
    } finally { recovery = undefined; }
  })();
  return recovery;
}

// A single transport boundary covers generated hooks, direct fetches and exports.
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(`${base}/api/`)) return originalFetch(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const read = method === "GET" || method === "HEAD";
  if (recovery) await recovery;
  if (state !== "ready" && !(await verifySession())) {
    return new Response(JSON.stringify({ error: "Session verification required. Your request was not sent." }), {
      status: state === "expired" ? 401 : state === "denied" ? 403 : 503, headers: { "Content-Type": "application/json" },
    });
  }
  const sentGeneration = generation;
  const response = await originalFetch(input, init);
  if (sentGeneration !== generation || sessionSnapshot() === "changed" || sessionSnapshot() === "denied") {
    return new Response(JSON.stringify({ error: "Account changed. Reload before continuing." }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  const redirectedToLogin = response.redirected && new URL(response.url, location.href).pathname.startsWith("/.auth/");
  if (response.status !== 401 && !redirectedToLogin) return response;
  setState("checking");
  const restored = await verifySession(true);
  // Never replay mutations: their outcome may be uncertain.
  if (restored && read && !(input instanceof Request)) return originalFetch(input, init);
  if (!read) document.dispatchEvent(new Event("loan-save-interrupted"));
  return redirectedToLogin
    ? new Response(JSON.stringify({ error: "Sign in required. Saves are not repeated automatically." }), { status: 401, headers: { "Content-Type": "application/json" } })
    : response;
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state !== "changed" && state !== "denied") void verifySession();
});
window.addEventListener("focus", () => {
  if (state !== "changed" && state !== "denied") void verifySession();
});
const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("loan-session");
channel?.addEventListener("message", event => {
  if (event.data === "logout") { generation++; identity = undefined; setState("denied"); }
  else if (event.data === "recheck") void verifySession();
});
document.addEventListener("click", event => {
  const anchor = (event.target as Element)?.closest?.("a");
  if (anchor?.getAttribute("href")?.startsWith("/.auth/logout")) {
    channel?.postMessage("logout");
    generation++; identity = undefined; setState("denied");
  }
});
export function openSignIn() {
  window.open(`/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(`${base}/`)}`, "_blank", "noopener");
}
