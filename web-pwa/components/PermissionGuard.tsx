"use client";

import { useEffect, useState } from "react";
import { hasPermission, type PermissionedUser } from "@/lib/permissions";

// ─── Module-level user cache ──────────────────────────────────────────────────
// Shared across all <PermissionGuard> instances so N guards trigger only a
// single /api/auth/me request per page load. Permission changes made by an
// ADMIN (e.g. revoking a permission) take effect here without a full page
// reload: the cache is invalidated when the tab regains focus and all
// listening guards re-fetch once.
let cachedUser: PermissionedUser | null | undefined;
let fetchPromise: Promise<PermissionedUser | null> | null = null;
let listeners: Array<(user: PermissionedUser | null) => void> = [];
let visibilityWired = false;

function wireVisibilityRefresh() {
  if (visibilityWired || typeof window === "undefined") return;
  visibilityWired = true;
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    // Drop the cache so the next loadCurrentUser() re-fetches, and update
    // any guards already listening with the fresh result.
    const fresh = fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((user: PermissionedUser | null) => {
        cachedUser = user;
        fetchPromise = null;
        listeners.forEach((fn) => fn(user));
        return user;
      });
    void fresh;
  });
}

function loadCurrentUser(onUpdate?: (user: PermissionedUser | null) => void): Promise<PermissionedUser | null> {
  if (onUpdate) listeners.push(onUpdate);
  wireVisibilityRefresh();
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

function unloadCurrentUser(onUpdate?: (user: PermissionedUser | null) => void) {
  if (!onUpdate) return;
  listeners = listeners.filter((fn) => fn !== onUpdate);
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
    const onUpdate = (u: PermissionedUser | null) => {
      if (!cancelled) setActiveUser(u);
    };
    loadCurrentUser(onUpdate).then((u) => {
      if (!cancelled) setActiveUser(u);
    });

    return () => {
      cancelled = true;
      unloadCurrentUser(onUpdate);
    };
  }, [user]);

  // Still loading (and no user prop supplied) — hide the control to avoid
  // flashing sensitive actions before the permission check resolves.
  if (activeUser === undefined) return null;

  if (!hasPermission(activeUser, requires)) return null;

  return <>{children}</>;
}
