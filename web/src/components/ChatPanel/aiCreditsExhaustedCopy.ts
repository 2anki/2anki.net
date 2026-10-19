import { isPayingUser } from '../NavigationBar/helpers/getPlanLabel';

interface ExhaustedCopyLocals {
  patreon?: boolean;
  subscriber?: boolean;
  passKind?: '24h' | '7d' | '120d' | 'unlimited' | null;
}

export type AiCreditsExhaustedKey =
  | 'aiCreditsExhausted'
  | 'aiCreditsExhaustedPlan'
  | 'aiCreditsExhaustedPass';

export function aiCreditsExhaustedCopyKey(
  locals: ExhaustedCopyLocals | undefined | null
): AiCreditsExhaustedKey {
  const passKind = locals?.passKind;
  if (passKind === '24h' || passKind === '7d' || passKind === '120d') {
    return 'aiCreditsExhaustedPass';
  }
  if (isPayingUser(locals)) {
    return 'aiCreditsExhaustedPlan';
  }
  return 'aiCreditsExhausted';
}
