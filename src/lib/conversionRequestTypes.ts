import type { RescueRule } from '../types/RescueCandidate';

export interface ConversionWorkerRequest {
  id: string;
  owner: string;
  isPaying: boolean;
  type?: string;
  title: string;
  jobDbId: string | number;
  frontField?: string;
  backField?: string;
  rescueRule?: RescueRule;
  anonId?: string;
  signupOrigin?: string | null;
  requestId?: string;
}
