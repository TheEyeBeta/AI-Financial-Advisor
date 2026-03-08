import { useState, useEffect, useCallback } from 'react';

/**
 * Data source preference — persisted in localStorage.
 *
 * - "supabase"  → Default. All market data fetched from Supabase tables.
 * - "dataapi"   → Use TheEyeBetaDataAPI gateway (real-time engine data).
 * - "auto"      → Try DataAPI first, fall back to Supabase on error.
 */
export type DataSource = 'supabase' | 'dataapi' | 'auto';

const STORAGE_KEY = 'theeyebeta:data-source';
const DEFAULT_SOURCE: DataSource = 'supabase';

function readStored(): DataSource {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'supabase' || raw === 'dataapi' || raw === 'auto') return raw;
  } catch {
    // SSR or storage unavailable
  }
  return DEFAULT_SOURCE;
}

/**
 * Hook to read and toggle the user's preferred data source.
 *
 * ```tsx
 * const { dataSource, setDataSource } = useDataSource();
 * ```
 */
export function useDataSource() {
  const [dataSource, setDataSourceState] = useState<DataSource>(readStored);

  // Sync across tabs via storage event
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setDataSourceState(readStored());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const setDataSource = useCallback((source: DataSource) => {
    setDataSourceState(source);
    try {
      localStorage.setItem(STORAGE_KEY, source);
    } catch {
      // Storage full or unavailable
    }
  }, []);

  return { dataSource, setDataSource } as const;
}

/**
 * Build query string param for backend routes.
 * Returns `"dataapi"` only when the user has opted in; otherwise `undefined`
 * so the backend uses its default (Supabase).
 */
export function sourceParam(ds: DataSource): string | undefined {
  if (ds === 'dataapi' || ds === 'auto') return ds;
  return undefined;
}
