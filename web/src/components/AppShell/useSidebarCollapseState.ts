import { useCallback, useState } from 'react';

const COLLAPSED_STORAGE_KEY = 'sidebar.collapsed';

function readCollapsedFromStorage(): boolean {
  try {
    return globalThis.localStorage?.getItem(COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeCollapsedToStorage(next: boolean): void {
  try {
    globalThis.localStorage?.setItem(
      COLLAPSED_STORAGE_KEY,
      next ? 'true' : 'false'
    );
  } catch {
    // localStorage unavailable (private mode, blocked) — state still updates in memory
  }
}

export interface SidebarCollapseState {
  collapsed: boolean;
  onToggleClick: () => void;
}

export function useSidebarCollapseState(): SidebarCollapseState {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsedFromStorage);

  const onToggleClick = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsedToStorage(next);
  }, [collapsed]);

  return { collapsed, onToggleClick };
}
