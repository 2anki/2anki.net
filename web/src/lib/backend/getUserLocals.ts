import type Users from '@server/data_layer/public/Users';
import { getStoredPassToken } from '../anonymousPass';
import { forgetLastDeck } from '../upload/lastDeck';
import { get } from './api';
import { get2ankiApi } from './get2ankiApi';

interface GetUserLocalsResponse {
  locals: {
    owner: number;
    patreon: boolean;
    subscriber: boolean;
    subscriptionInfo: {
      active: boolean;
      email: string;
      linked_email: string;
    };
    passExpiresAt?: string | null;
    passKind?: '24h' | '7d' | '120d' | 'unlimited' | null;
    planSource?: 'stripe' | 'apple' | 'lifetime' | null;
  };
  linked_email: string;
  user?: Pick<Users, 'id' | 'name' | 'email' | 'patreon'> & {
    ankify_welcome_seen?: boolean;
    email_verified?: boolean;
    signup_country?: string | null;
    chat_consent_at?: string | null;
    created_at?: string | null;
    onboarded_at?: string | null;
  };
  features?: {
    kiUI: boolean;
    ops?: boolean;
    anonymousDayPassCard?: boolean;
    limitWallProPrice?: boolean;
    limitWallPassFirst?: boolean;
    thinDeckAiOffer?: boolean;
    anonymousAiPreview?: boolean;
    anonymousAiChoice?: boolean;
  };
  autoSyncActive?: boolean;
  autoSyncCapReached?: boolean;
  freePrintAvailable?: boolean | null;
  pending_email_change?: {
    new_email: string;
    requested_at: string;
  } | null;
}

// A pass bought before signing up moves to the account on the first signed-in
// read. X-Pass-Claim, not X-Pass-Token: the server ignores it without an
// account, so a page view never starts the pass clock.
export const getUserLocals = async (): Promise<GetUserLocalsResponse> => {
  const passToken = getStoredPassToken();
  const locals: GetUserLocalsResponse = await get(
    `${get2ankiApi().baseURL}users/debug/locals`,
    {
      redirect: true,
      headers: passToken == null ? undefined : { 'X-Pass-Claim': passToken },
    }
  );
  if (locals?.user?.id != null) {
    void forgetLastDeck();
  }
  return locals;
};
