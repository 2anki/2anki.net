import { createContext, useContext } from 'react';

export const OPS_WINDOWS = ['7d', '30d', '90d'] as const;
export type OpsWindow = (typeof OPS_WINDOWS)[number];
export const DEFAULT_OPS_WINDOW: OpsWindow = '30d';
export const OPS_WINDOW_PARAM = 'window';

export const isOpsWindow = (
  value: string | null | undefined
): value is OpsWindow =>
  value != null && (OPS_WINDOWS as readonly string[]).includes(value);

export const parseOpsWindow = (value: string | null | undefined): OpsWindow =>
  isOpsWindow(value) ? value : DEFAULT_OPS_WINDOW;

export const OpsWindowContext = createContext<OpsWindow>(DEFAULT_OPS_WINDOW);

export const useOpsWindow = (): OpsWindow => useContext(OpsWindowContext);
