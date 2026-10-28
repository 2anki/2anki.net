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
      // The session is optional here, so a failed lookup serves the request
      // signed out instead of failing a download or an event write.
      try {
        const user = await authService.getUserFrom(token);
        if (user) {
          res.locals.owner = user.owner;
        }
      } catch (error) {
        console.warn('[optional-auth] session lookup failed', {
          errorClass:
            error instanceof Error ? error.constructor.name : typeof error,
        });
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
