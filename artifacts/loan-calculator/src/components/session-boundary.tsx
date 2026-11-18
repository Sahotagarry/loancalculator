import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { sessionSnapshot, subscribeSession, verifySession, openSignIn, verifiedIdentityEvent } from "@/lib/session-recovery";
import { queryClient } from "@/lib/queryClient";
import { getGetAuthMeQueryKey } from "@workspace/api-client-react";
import { createPortal } from "react-dom";

export function SessionBoundary({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeSession, sessionSnapshot);
  const [mounted, setMounted] = useState(false);
  const [saveInterrupted, setSaveInterrupted] = useState(false);
  useEffect(() => {
    const verified = (event: Event) => queryClient.setQueryData(getGetAuthMeQueryKey(), (event as CustomEvent).detail);
    const interrupted = () => setSaveInterrupted(true);
    document.addEventListener(verifiedIdentityEvent, verified);
    document.addEventListener("loan-save-interrupted", interrupted);
    void verifySession();
    return () => {
      document.removeEventListener(verifiedIdentityEvent, verified);
      document.removeEventListener("loan-save-interrupted", interrupted);
    };
  }, []);
  useEffect(() => {
    if (state === "ready") {
      setMounted(true);
    }
    if (state === "changed" || state === "denied") {
      setMounted(false);
      setSaveInterrupted(false);
      queryClient.clear();
    }
  }, [state]);
  const blocked = state !== "ready";
  return <>
    {blocked && <style>{`body > div:not(#root) { visibility: hidden !important; pointer-events: none !important; }`}</style>}
    {!blocked && saveInterrupted && <div role="alert" className="border-b bg-amber-50 p-4 text-amber-950">
      A save was interrupted by authentication and was not automatically repeated. Check whether it was saved before trying again.
      <button className="ml-3 underline" onClick={() => setSaveInterrupted(false)}>Dismiss</button>
    </div>}
    {mounted && <div hidden={blocked} inert={blocked}>{children}</div>}
    {blocked && createPortal(<main
      className="fixed inset-0 z-[1000] bg-background flex items-center justify-center p-6"
      style={{ pointerEvents: "auto" }}
      onPointerDownCapture={event => event.stopPropagation()}
      onFocusCapture={event => event.stopPropagation()}
      onKeyDownCapture={event => {
        // Keep recovery usable even while a preserved Radix modal owns focus.
        if (event.key !== "Tab") return;
        event.preventDefault();
        event.stopPropagation();
        const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
      }}
    >
      <section className="max-w-lg rounded-xl border bg-card p-8 space-y-4" role="alert">
        <h1 className="text-xl font-semibold">
          {state === "checking" ? "Checking your sign-in…" : state === "expired" ? "Sign in to continue" :
            state === "denied" ? "Access unavailable" : state === "changed" ? "Signed in as a different user" : "Unable to verify your session"}
        </h1>
        <p>{state === "checking" ? "Please wait while we verify your identity." :
          state === "changed" || state === "denied" ? "Previous account data has been cleared. Reload after signing in with an authorized account." :
          mounted ? "Your unsaved form is held in this tab. Requests are paused. Sign in in a new tab if needed, then return here and retry. Saves are not repeated automatically." :
          "Your clients have not been loaded. This does not mean they were deleted. Try again or sign in."}</p>
        {state !== "checking" && <div className="flex gap-3">
          <button className="rounded bg-primary px-4 py-2 text-primary-foreground" onClick={() => {
            if (state === "changed" || state === "denied") location.reload();
            else void verifySession(true).then(ok => { if (ok) void queryClient.invalidateQueries(); });
          }}>{state === "changed" || state === "denied" ? "Reload" : "Retry"}</button>
          <button className="rounded border px-4 py-2" onClick={openSignIn}>Sign in in new tab</button>
        </div>}
      </section>
    </main>, document.body)}
  </>;
}
