'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import app, { database } from '@/firebase';
import { getAuth, onAuthStateChanged, getIdTokenResult, User } from 'firebase/auth';
import { ref, get } from 'firebase/database';

type Props = {
  children: React.ReactNode;
  /** Redirect unauthenticated users here (default: /login). */
  loginPath?: string;
  /** If provided, require any of these role names (checks /roles/{uid}). */
  requireAnyRole?: string[];
  /** Optional: show a custom loader while checking auth. */
  fallback?: React.ReactNode;
};

export default function AuthGate({
  children,
  loginPath = '/login',
  requireAnyRole,
  fallback,
}: Props) {
  const auth = getAuth(app);
  const router = useRouter();
  const pathname = usePathname();

  const [state, setState] = useState<{
    loading: boolean;
    user: User | null;
    allowed: boolean | null;
    error?: string | null;
  }>({ loading: true, user: null, allowed: null, error: null });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setState({ loading: false, user: null, allowed: false, error: null });
        return;
      }

      // Optional: pick up custom claims quickly (not required)
      try {
        await getIdTokenResult(u, true);
      } catch {}

      // Role check (optional)
      if (requireAnyRole && requireAnyRole.length > 0) {
        try {
          const snap = await get(ref(database, `roles/${u.uid}`));
          const roleData = snap.exists() ? snap.val() : null;
          const userRole = roleData?.role as string | undefined;
          const active = roleData?.active !== false;
          const ok = !!userRole && active && requireAnyRole.includes(userRole);
          setState({ loading: false, user: u, allowed: ok, error: ok ? null : 'forbidden' });
        } catch (e) {
          setState({ loading: false, user: u, allowed: false, error: 'forbidden' });
        }
      } else {
        setState({ loading: false, user: u, allowed: true, error: null });
      }
    });

    return () => unsub();
  }, [auth, requireAnyRole]);

  // Kick to login if not allowed
  useEffect(() => {
    if (!state.loading && state.allowed === false) {
      const dest = `${loginPath}?next=${encodeURIComponent(pathname || '/')}`;
      router.replace(dest);
    }
  }, [state.loading, state.allowed, pathname, router, loginPath]);

  // Loading UI
  if (state.loading) {
    return (
      <>
        {fallback ?? (
          <div className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            Checking your session…
          </div>
        )}
      </>
    );
  }

  // If explicitly forbidden (role check failed), you can render a 403 message
  if (state.allowed === false && state.user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Access denied</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Your account does not have permission to view this page.
        </p>
      </div>
    );
  }

  // Auth OK
  return <>{children}</>;
}
