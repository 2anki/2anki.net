import { Request, Response, NextFunction } from 'express';
import AuthenticationService from '../../services/AuthenticationService';
import TokenRepository from '../../data_layer/TokenRepository';
import UsersRepository from '../../data_layer/UsersRepository';
import { getDatabase } from '../../data_layer';

export const makeOptionalAuthMiddleware = (
  authService: AuthenticationService
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const token = req.cookies?.token;
    if (token) {
      const user = await authService.getUserFrom(token);
      if (user) {
        res.locals.owner = user.owner;
      }
    }
    next();
  };
};

export const optionalAuthMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const database = getDatabase();
  const authService = new AuthenticationService(
    new TokenRepository(database),
    new UsersRepository(database)
  );
  return makeOptionalAuthMiddleware(authService)(req, res, next);
};

// A download only reads the session to tag deck_downloaded with the user, so
// a failed lookup must not fail the download. Routes that gate on the owner
// (checkout's duplicate-purchase guard) keep optionalAuthMiddleware, where a
// failed lookup is an error rather than a signed-out request (#5057).
export const makeDownloadIdentityMiddleware = (
  authService: AuthenticationService
) => {
  const resolveOwner = makeOptionalAuthMiddleware(authService);
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      await resolveOwner(req, res, () => undefined);
    } catch (error) {
      console.warn('[download-identity] session lookup failed', {
        errorClass:
          error instanceof Error ? error.constructor.name : typeof error,
      });
    }
    next();
  };
};

export const downloadIdentityMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const database = getDatabase();
  const authService = new AuthenticationService(
    new TokenRepository(database),
    new UsersRepository(database)
  );
  return makeDownloadIdentityMiddleware(authService)(req, res, next);
};
