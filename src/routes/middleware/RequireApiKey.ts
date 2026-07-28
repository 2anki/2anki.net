import express, { NextFunction, RequestHandler } from 'express';
import { getDatabase } from '../../data_layer';
import ApiKeyRepository, {
  IApiKeyRepository,
} from '../../data_layer/ApiKeyRepository';
import UsersRepository from '../../data_layer/UsersRepository';
import TokenRepository from '../../data_layer/TokenRepository';
import AuthenticationService from '../../services/AuthenticationService';
import {
  extractApiKeyFromHeader,
  hashApiKey,
} from '../../lib/apiKeys/apiKeyToken';
import { applyUserLocals } from './configureUserLocal';
import { getEventsSink } from '../../services/events/eventsSinkInstance';
import { InMemoryRateLimiter } from '../../lib/rateLimit/InMemoryRateLimiter';
import DeveloperTiersRepository from '../../data_layer/DeveloperTiersRepository';
import ResolveDeveloperTierUseCase, {
  ResolvedDeveloperTier,
} from '../../usecases/developer/ResolveDeveloperTierUseCase';
import { DeveloperSubscriptionsRepository } from '../../data_layer/DeveloperSubscriptionsRepository';
import SubscriptionService from '../../services/SubscriptionService';

const USAGE_EVENT_THROTTLE_MS = 60_000;
const lastUsageEventAt = new Map<number, number>();

const RATE_WINDOW_MS = 60_000;
const tierLimiters = new Map<string, InMemoryRateLimiter>();

function limiterForTier(tier: ResolvedDeveloperTier): InMemoryRateLimiter {
  const cacheKey = `${tier.tier_key}:${tier.requests_per_minute}`;
  const existing = tierLimiters.get(cacheKey);
  if (existing != null) {
    return existing;
  }
  const limiter = new InMemoryRateLimiter({
    windowMs: RATE_WINDOW_MS,
    perKeyMax: tier.requests_per_minute,
    globalMax: tier.requests_per_minute * 200,
  });
  tierLimiters.set(cacheKey, limiter);
  return limiter;
}

const TIER_CACHE_TTL_MS = 60_000;
const tierCache = new Map<
  number,
  { tier: ResolvedDeveloperTier; at: number }
>();

function cachedTier(userId: number, now: number): ResolvedDeveloperTier | null {
  const entry = tierCache.get(userId);
  if (entry == null || now - entry.at > TIER_CACHE_TTL_MS) {
    return null;
  }
  return entry.tier;
}

export type TierResolver = (input: {
  patreon: boolean;
  activeProductIds: string[];
}) => Promise<ResolvedDeveloperTier>;

export interface RequireApiKeyDeps {
  apiKeyRepo?: IApiKeyRepository;
  usersRepo?: UsersRepository;
  authService?: AuthenticationService;
  now?: () => Date;
  tierResolver?: TierResolver;
  getActiveProductIds?: (email: string) => Promise<string[]>;
  rateLimiterForTier?: (tier: ResolvedDeveloperTier) => {
    check(key: string): boolean;
  };
}

function recordUsage(keyId: number, userId: number, at: number) {
  const previous = lastUsageEventAt.get(keyId) ?? 0;
  if (at - previous < USAGE_EVENT_THROTTLE_MS) {
    return;
  }
  lastUsageEventAt.set(keyId, at);
  getEventsSink().record({
    name: 'api_key_used',
    user_id: userId,
    anonymous_id: null,
    props: {},
    created_at: new Date(at),
  });
}

/**
 * Bearer API-key authentication. Resolves `Authorization: Bearer sk_live_...`
 * to the owning user and populates `res.locals` via the shared
 * `applyUserLocals`, so every downstream quota/paying check behaves exactly as
 * it does for a session cookie. Fails closed with 401 on a missing, malformed,
 * unknown, or revoked key — it never falls through to anonymous.
 */
export function makeRequireApiKey(
  deps: RequireApiKeyDeps = {}
): RequestHandler {
  return async (
    req: express.Request,
    res: express.Response,
    next: NextFunction
  ) => {
    const raw = extractApiKeyFromHeader(req.headers.authorization);
    if (raw == null) {
      return res.status(401).json({ message: 'API key required' });
    }

    const database = getDatabase();
    const apiKeyRepo = deps.apiKeyRepo ?? new ApiKeyRepository(database);
    const usersRepo = deps.usersRepo ?? new UsersRepository(database);

    const active = await apiKeyRepo.findActiveByHash(hashApiKey(raw));
    if (active == null) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    const user = await usersRepo.getById(String(active.user_id));
    if (user == null) {
      return res.status(401).json({ message: 'Invalid API key' });
    }

    const authService =
      deps.authService ??
      new AuthenticationService(new TokenRepository(database), usersRepo);
    await applyUserLocals(
      res,
      { ...user, owner: user.id },
      authService,
      database
    );

    const getProductIds =
      deps.getActiveProductIds ??
      (async (email: string) => {
        const subscriptions =
          await SubscriptionService.getUserActiveSubscriptions(email);
        const baseProductIds = subscriptions
          .map((subscription) => subscription.stripe_product_id)
          .filter((id): id is string => id != null && id !== '');
        // Developer tiers live in their own table because they are a second
        // concurrent subscription; the base plan cannot represent them without
        // one overwriting the other. Both sets feed the resolver, which already
        // takes an array and picks the highest limit among the tiers owned.
        const developerRepo = new DeveloperSubscriptionsRepository(database);
        const developerProductIds = await developerRepo.activeProductIdsForUser(
          active.user_id
        );
        const byEmail =
          developerProductIds.length > 0
            ? []
            : await developerRepo.activeProductIdsForEmail(email);
        return [
          ...new Set([...baseProductIds, ...developerProductIds, ...byEmail]),
        ];
      });
    const resolveTier =
      deps.tierResolver ??
      ((input: { patreon: boolean; activeProductIds: string[] }) =>
        new ResolveDeveloperTierUseCase(
          new DeveloperTiersRepository(database)
        ).execute(input));

    const nowMs = (deps.now ?? (() => new Date()))().getTime();
    const useCache = deps.tierResolver == null;
    let tier = useCache ? cachedTier(active.user_id, nowMs) : null;
    if (tier == null) {
      tier = await resolveTier({
        patreon: user.patreon === true,
        activeProductIds:
          user.patreon === true || user.email == null
            ? []
            : await getProductIds(user.email),
      });
      if (useCache) {
        tierCache.set(active.user_id, { tier, at: nowMs });
      }
    }

    const limiter = (deps.rateLimiterForTier ?? limiterForTier)(tier);
    if (!limiter.check(String(active.user_id))) {
      return res.status(429).json({
        message: `Rate limit reached for the ${tier.tier_key} tier (${tier.requests_per_minute} requests per minute). Try again in a minute.`,
      });
    }

    res.locals.api_key_auth = true;
    res.locals.developer_tier = tier;

    void apiKeyRepo.touchLastUsed(active.id, new Date(nowMs));
    recordUsage(active.id, active.user_id, nowMs);

    return next();
  };
}

const RequireApiKey = makeRequireApiKey();
export default RequireApiKey;

/**
 * Accept EITHER a bearer API key OR the existing gate. Key-first: when an
 * `sk_live_...` bearer is present it runs `RequireApiKey` (fail-closed); with no
 * bearer it runs `fallback` unchanged, so the browser/session path is
 * byte-identical. Used to add key auth to routes without touching their cookie
 * behavior — e.g. `acceptKeyOr(RequireAllowedOrigin)` lets a token client skip
 * the browser Origin allowlist while a browser request still enforces it.
 */
export function acceptKeyOr(fallback: RequestHandler): RequestHandler {
  const requireApiKey = makeRequireApiKey();
  return (req: express.Request, res: express.Response, next: NextFunction) => {
    const raw = extractApiKeyFromHeader(req.headers.authorization);
    if (raw != null) {
      return requireApiKey(req, res, next);
    }
    return fallback(req, res, next);
  };
}
