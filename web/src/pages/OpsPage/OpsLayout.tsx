import { useCallback, useEffect } from 'react';
import { Outlet, useLocation, useSearchParams } from 'react-router-dom';

import sharedStyles from '../../styles/shared.module.css';
import styles from './OpsPage.module.css';
import { OPS_TABS } from './opsTabs';
import {
  OPS_WINDOW_PARAM,
  OpsWindow,
  OpsWindowContext,
  parseOpsWindow,
} from './opsWindow';
import { OpsFreshness, OpsWindowControl } from './OpsHeaderControls';

const PAGE_TITLE = 'Ops · 2anki';

export default function OpsLayout() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    document.title = PAGE_TITLE;
  }, []);

  const window = parseOpsWindow(searchParams.get(OPS_WINDOW_PARAM));
  const setWindow = useCallback(
    (next: OpsWindow) => {
      const params = new URLSearchParams(searchParams);
      params.set(OPS_WINDOW_PARAM, next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const fullPath = `${location.pathname}${location.search}`;
  const activeTab = OPS_TABS.find((tab) => tab.match(fullPath));

  return (
    <OpsWindowContext.Provider value={window}>
      <main className={sharedStyles.pageWide} data-hj-suppress>
        <header className={styles.opsHeader}>
          <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
            <h1 className={sharedStyles.title}>Ops</h1>
            {activeTab && (
              <span className={styles.breadcrumbSection} aria-current="page">
                {activeTab.label}
              </span>
            )}
          </nav>
          <div className={styles.headerControls}>
            <OpsWindowControl window={window} onChange={setWindow} />
            <OpsFreshness />
          </div>
        </header>
        <Outlet />
      </main>
    </OpsWindowContext.Provider>
  );
}
