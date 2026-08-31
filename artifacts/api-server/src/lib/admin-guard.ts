import type { AppUserRole } from "@workspace/db";

export function removesLastActiveAdmin(
  current: { role: AppUserRole; isActive: boolean },
  update: { role?: AppUserRole; isActive?: boolean },
  activeAdminCount: number,
): boolean {
  const remainsActiveAdmin =
    (update.role ?? current.role) === "admin" && (update.isActive ?? current.isActive);
  return current.role === "admin" && current.isActive && !remainsActiveAdmin && activeAdminCount <= 1;
}