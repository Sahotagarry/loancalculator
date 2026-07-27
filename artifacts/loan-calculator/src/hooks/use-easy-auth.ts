import { useEffect, useState } from "react";

interface EasyAuthUser {
  displayName: string | null;
}

/**
 * Detects Azure App Service Authentication ("Easy Auth" / Microsoft 365 login).
 *
 * When the app is deployed to Azure App Service with authentication enabled,
 * the platform exposes `/.auth/me` describing the signed-in user. Anywhere
 * else (Replit preview, local dev, or Azure without auth) that endpoint does
 * not exist, so this hook resolves to "not authenticated" and the sign-out
 * button stays hidden.
 */
export function useEasyAuth(): { user: EasyAuthUser | null } {
  const [user, setUser] = useState<EasyAuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/.auth/me", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return null;
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) return null;
        const data: unknown = await res.json();
        if (!Array.isArray(data) || data.length === 0) return null;
        const entry = data[0] as {
          user_id?: string;
          user_claims?: Array<{ typ?: string; val?: string }>;
        };
        const claims = entry.user_claims ?? [];
        const nameClaim =
          claims.find((c) => c.typ === "name")?.val ??
          claims.find(
            (c) =>
              c.typ ===
              "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
          )?.val ??
          entry.user_id ??
          null;
        return { displayName: nameClaim };
      })
      .catch(() => null)
      .then((result) => {
        if (!cancelled) setUser(result);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { user };
}

/** Azure App Service logout endpoint; ends the Easy Auth session and returns to the app root. */
export const EASY_AUTH_LOGOUT_URL = "/.auth/logout?post_logout_redirect_uri=/";
