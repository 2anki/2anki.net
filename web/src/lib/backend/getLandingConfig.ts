import { get } from './api';

export interface LandingConfig {
  showPassPrices: boolean;
}

export const getLandingConfig = async (): Promise<LandingConfig> => {
  const data = await get('/api/landing/config');
  if (data == null || typeof data.showPassPrices !== 'boolean') {
    return { showPassPrices: false };
  }
  return { showPassPrices: data.showPassPrices };
};
