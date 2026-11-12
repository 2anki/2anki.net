import type express from 'express';
import { countryFromClientIp, trackingAllowedFor } from '../http/consentRegion';
import { classifyDevice, type DeviceClass } from './classifyDevice';

export interface CheckoutRequestProps {
  country: string | null;
  device: DeviceClass;
}

export function checkoutRequestProps(
  req: express.Request
): CheckoutRequestProps {
  return {
    country: trackingAllowedFor(req) ? countryFromClientIp(req) : null,
    device: classifyDevice(req.headers?.['user-agent']),
  };
}
