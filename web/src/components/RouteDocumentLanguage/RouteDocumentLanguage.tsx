import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { setRouteDocumentLanguage } from '../../lib/i18n/documentLanguage';
import { routeDocumentLanguage } from '../../lib/i18n/routeLanguage';
import { useAppLanguage } from '../../lib/i18n/useAppLanguage';

export function RouteDocumentLanguage() {
  const { pathname } = useLocation();
  const appLanguage = useAppLanguage();

  useLayoutEffect(() => {
    setRouteDocumentLanguage(routeDocumentLanguage(pathname, appLanguage));
  }, [pathname, appLanguage]);

  return null;
}
