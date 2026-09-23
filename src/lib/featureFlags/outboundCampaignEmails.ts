import { getFeatureFlag } from './getFeatureFlag';

export const OUTBOUND_CAMPAIGN_EMAILS_FLAG = 'outbound_campaign_emails';

// Gates the automated campaign drips (inactivity warnings, re-engagement).
// Default OFF: sending resumed only by an explicit /ops flip. The drips target
// the stalest addresses in the database, and their bounces — not volume — are
// what tripped SendGrid's bounce-rate limitation in 2026-09. Transactional
// email (magic links, receipts, password resets) does not consult this flag.
export function outboundCampaignEmailsEnabled(): Promise<boolean> {
  return getFeatureFlag(OUTBOUND_CAMPAIGN_EMAILS_FLAG, false);
}
