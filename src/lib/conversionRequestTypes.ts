export interface ConversionWorkerRequest {
  id: string;
  owner: string;
  isPaying: boolean;
  type?: string;
  title: string;
  jobDbId: string | number;
  frontField?: string;
  backField?: string;
  anonId?: string;
  signupOrigin?: string | null;
  requestId?: string;
}
