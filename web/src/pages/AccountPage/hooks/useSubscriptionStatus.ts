import { useMemo } from 'react';

type PassKind = '24h' | '7d' | '120d' | 'unlimited';

interface UserLocals {
  subscriber?: boolean;
  patreon?: boolean;
  passKind?: PassKind | null;
  passExpiresAt?: string | null;
}

export type PlanName =
  | 'pro'
  | 'autoSync'
  | 'lifetime'
  | 'dayPass'
  | 'weekPass'
  | 'semesterPass'
  | 'free';

const DATED_PASS_PLAN: Record<'24h' | '7d' | '120d', PlanName> = {
  '24h': 'dayPass',
  '7d': 'weekPass',
  '120d': 'semesterPass',
};

function resolvePlan(
  locals: UserLocals | undefined,
  autoSyncActive: boolean
): PlanName {
  if (locals?.patreon) return 'lifetime';
  const passKind = locals?.passKind;
  if (passKind === '24h' || passKind === '7d' || passKind === '120d') {
    return DATED_PASS_PLAN[passKind];
  }
  if (locals?.subscriber) return autoSyncActive ? 'autoSync' : 'pro';
  return 'free';
}

export function useSubscriptionStatus(
  locals: UserLocals | undefined,
  autoSyncActive = false
) {
  const plan = useMemo(
    () => resolvePlan(locals, autoSyncActive),
    [locals?.patreon, locals?.subscriber, locals?.passKind, autoSyncActive]
  );

  const hasActivePlan = useMemo(
    () => Boolean(locals?.subscriber || locals?.patreon),
    [locals?.subscriber, locals?.patreon]
  );

  return {
    plan,
    hasActivePlan,
    passExpiresAt: locals?.passExpiresAt ?? null,
  };
}
