import { useEffect, useRef } from "react";
import { useGetAuthMe, getGetAuthMeQueryKey, type AuthMe } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";

export type AppCapability =
  | 'read'
  | 'write' 
  | 'delete'
  | 'purge'
  | 'manage_settings';

export function hasCapability(role: AuthMe['role'], cap: AppCapability) {
  if (role === 'admin') return true;
  if (role === 'manager') return ['read', 'write', 'delete'].includes(cap);
  if (role === 'accountant') return ['read', 'write'].includes(cap);
  return cap === 'read';
}

export function useAuth() {
  const query = useGetAuthMe({
    query: {
      queryKey: getGetAuthMeQueryKey(),
      retry: false,
    }
  });

  const user = query.data;
  
  const lastObjectId = useRef<string | null>(null);

  useEffect(() => {
    if (user?.objectId && lastObjectId.current !== null && lastObjectId.current !== user.objectId) {
      // Identity changed, clear all queries except auth
      const authKey = getGetAuthMeQueryKey();
      queryClient.resetQueries({
        predicate: (q) => JSON.stringify(q.queryKey) !== JSON.stringify(authKey)
      });
    }
    if (user?.objectId) {
      lastObjectId.current = user.objectId;
    }
  }, [user?.objectId]);

  const capabilities = {
    canWrite: user ? hasCapability(user.role, 'write') : false,
    canDelete: user ? hasCapability(user.role, 'delete') : false,
    canPurge: user ? hasCapability(user.role, 'purge') : false,
    canManageSettings: user ? hasCapability(user.role, 'manage_settings') : false,
  };

  return {
    user,
    isLoading: query.isLoading,
    error: query.error,
    isDevIdentity: user?.tenantId === "clearline-development-tenant"
      && user?.objectId === "clearline-development-administrator",
    ...capabilities
  };
}

/** Azure App Service logout endpoint; ends the Easy Auth session and returns to the app root. */
export const EASY_AUTH_LOGOUT_URL = "/.auth/logout?post_logout_redirect_uri=/";
