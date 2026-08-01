"use client";

import { useEffect, useState } from "react";
import { hasPermission, type PermissionedUser } from "@/lib/permissions";

// ─── Module-level user cache ──────────────────────────────────────────────────
// Shared across all <PermissionGuard> instances so N guards trigger only a
// single /api/auth/me request per page load.
let cachedUser: PermissionedUser | null | undefined;
let fetchPromise: Promise<PermissionedUser | null> | null = null;

function loadCurrentUser(): Promise<PermissionedUser | null> {
  if (cachedUser !== undefined) return Promise.resolve(cachedUser);
  if (!fetchPromise) {
    fetchPromise = fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((user: PermissionedUser | null) => {
        cachedUser = user;
        return user;
      });
  }
  return fetchPromise;
}

interface PermissionGuardProps {
  children: React.ReactNode;
  /** Permission key required to render `children`, e.g. "ORDERS_EDIT". */
  requires: string;
  /** Optional pre-loaded user to skip the internal /api/auth/me fetch. */
  user?: PermissionedUser | null;
}

/**
 * Button-level RBAC guard.
 *
 * Renders `children` only when the active user holds `requires` (via their
 * assigned PermissionGroup OR custom permissions). Otherwise renders `null`.
 */
export default function PermissionGuard({
  children,
  requires,
  user,
}: PermissionGuardProps) {
  const [activeUser, setActiveUser] = useState<
    PermissionedUser | null | undefined
  >(user);

  useEffect(() => {
    // If the parent already loaded the user, use it directly.
    if (user !== undefined) {
      setActiveUser(user);
      return;
    }

    let cancelled = false;
    loadCurrentUser().then((u) => {
      if (!cancelled) setActiveUser(u);
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Still loading (and no user prop supplied) — hide the control to avoid
  // flashing sensitive actions before the permission check resolves.
  if (activeUser === undefined) return null;

  if (!hasPermission(activeUser, requires)) return null;

  return <>{children}</>;
}
