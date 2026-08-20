import Users from '../../schemas/public/Users';
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
    passKind?: '24h' | '7d' | 'unlimited' | null;
    planSource?: 'stripe' | 'apple' | 'lifetime' | null;
  };
  linked_email: string;
  user?: Users & {
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
  };
  autoSyncActive?: boolean;
  freePrintAvailable?: boolean | null;
}

export const getUserLocals = async (): Promise<GetUserLocalsResponse> =>
  get(`${get2ankiApi().baseURL}users/debug/locals`);
