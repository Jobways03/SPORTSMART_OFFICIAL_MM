'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from './api-client';

interface MeResponse {
  adminId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  permissions: string[];
  isSuperAdmin: boolean;
}

interface PermissionsContextValue {
  loading: boolean;
  me: MeResponse | null;
  permissions: Set<string>;
  isSuperAdmin: boolean;
  hasPermission: (key: string) => boolean;
  hasAnyPermission: (keys: string[]) => boolean;
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextValue | undefined>(undefined);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await apiClient<MeResponse>('/admin/auth/me');
      if (res.data) setMe(res.data);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const permissions = useMemo(
    () => new Set(me?.permissions ?? []),
    [me?.permissions],
  );

  const hasPermission = useCallback(
    (key: string) => {
      if (!me) return false;
      if (me.isSuperAdmin) return true;
      return permissions.has(key);
    },
    [me, permissions],
  );

  const hasAnyPermission = useCallback(
    (keys: string[]) => {
      if (!me) return false;
      if (me.isSuperAdmin) return true;
      return keys.some((k) => permissions.has(k));
    },
    [me, permissions],
  );

  const value: PermissionsContextValue = {
    loading,
    me,
    permissions,
    isSuperAdmin: me?.isSuperAdmin ?? false,
    hasPermission,
    hasAnyPermission,
    refresh,
  };

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error('usePermissions must be used inside <PermissionsProvider>');
  }
  return ctx;
}

/**
 * Wraps a page or section. Renders children only if the current admin has at
 * least one of the listed permissions. Otherwise redirects to the dashboard
 * home with a query flag (?denied=1) the layout can use to flash a toast.
 *
 * Pass `superAdminOnly` instead of `anyOf` for pages that are exclusive to
 * Super Admin (Users + Roles management).
 */
export function RequirePermission({
  anyOf,
  superAdminOnly,
  fallback = null,
  children,
}: {
  anyOf?: string[];
  superAdminOnly?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const { loading, me, isSuperAdmin, hasAnyPermission } = usePermissions();

  const allowed = useMemo(() => {
    if (loading || !me) return null; // unknown yet
    if (superAdminOnly) return isSuperAdmin;
    if (!anyOf || anyOf.length === 0) return true;
    return hasAnyPermission(anyOf);
  }, [loading, me, isSuperAdmin, anyOf, superAdminOnly, hasAnyPermission]);

  useEffect(() => {
    if (allowed === false) {
      router.replace('/dashboard?denied=1');
    }
  }, [allowed, router]);

  if (allowed === null) return <>{fallback}</>;
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
