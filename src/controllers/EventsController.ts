import { Request, Response } from 'express';
import { KNOWN_EVENTS } from '../types/AnalyticsEvents';
import { TrackEventUseCase } from '../usecases/events/TrackEventUseCase';
import { parseFirstTouch } from './helpers/parseFirstTouch';

const PROPS_MAX_BYTES = 1024;
const EVENT_NAME_MAX_LENGTH = 64;

export class EventsController {
  constructor(private readonly trackEventUseCase: TrackEventUseCase) {}

  track(req: Request, res: Response): void {
    const { name, props } = (req.body ?? {}) as {
      name: unknown;
      props?: unknown;
    };

    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > EVENT_NAME_MAX_LENGTH
    ) {
      res.status(400).json({ error: 'Invalid event name' });
      return;
    }

    const safeProps = this.resolveProps(props);
    if (safeProps === null) {
      res.status(400).json({ error: 'Invalid props' });
      return;
    }

    const serialized = JSON.stringify(safeProps);
    if (serialized.length > PROPS_MAX_BYTES) {
      res.status(400).json({ error: 'Props too large' });
      return;
    }

    const userId = (res.locals.owner as number | undefined) ?? null;
    const anonymousId = (req.cookies?.anon_id as string | undefined) ?? null;

    this.trackEventUseCase.execute({
      name,
      unknown: !KNOWN_EVENTS.has(
        name as Parameters<typeof KNOWN_EVENTS.has>[0]
      ),
      userId,
      anonymousId,
      props: this.withSignupOrigin(safeProps, req),
    });

    res.status(202).end();
  }

  private withSignupOrigin(
    props: Record<string, unknown>,
    req: Request
  ): Record<string, unknown> {
    if (typeof props.signup_origin === 'string') {
      return props;
    }
    const { signupOrigin } = parseFirstTouch(req.cookies?.first_touch);
    if (signupOrigin == null) {
      return props;
    }
    return { ...props, signup_origin: signupOrigin };
  }

  private resolveProps(raw: unknown): Record<string, unknown> | null {
    if (raw == null) return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  }
}
