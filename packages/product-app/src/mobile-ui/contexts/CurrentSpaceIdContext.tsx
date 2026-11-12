/**
 * 当前空间 ID：切换空间后更新，用于让 Web 左侧栏按 key 完全 remount（不同空间可展示不同栏目）。
 */
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Platform } from 'react-native';
import { getCurrentSpace } from '@/lib/auth';

type CurrentSpaceIdContextValue = {
  currentSpaceId: string | null;
  setCurrentSpaceId: (id: string | null) => void;
};

const CurrentSpaceIdContext = createContext<CurrentSpaceIdContextValue | null>(null);

export function CurrentSpaceIdProvider({ children }: { children: ReactNode }) {
  const [currentSpaceId, setCurrentSpaceIdState] = useState<string | null>(null);

  const setCurrentSpaceId = useCallback((id: string | null) => {
    setCurrentSpaceIdState(id);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    getCurrentSpace(true)
      .then((space) => {
        if (!cancelled && space?.id) setCurrentSpaceIdState(space.id);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const value: CurrentSpaceIdContextValue = { currentSpaceId, setCurrentSpaceId };

  return (
    <CurrentSpaceIdContext.Provider value={value}>
      {children}
    </CurrentSpaceIdContext.Provider>
  );
}

export function useCurrentSpaceId() {
  const ctx = useContext(CurrentSpaceIdContext);
  return ctx;
}
