import { NextFunction, Request, Response } from 'express';

import { ALLOWED_ORIGINS } from '../../lib/constants';
import AuthenticationService from '../../services/AuthenticationService';
import UsersRepository from '../../data_layer/UsersRepository';
import TokenRepository from '../../data_layer/TokenRepository';
import { getDatabase } from '../../data_layer';
import { configureUserLocal } from './configureUserLocal';
import { sanitizeForLog } from '../../lib/log/sanitizeForLog';

const RequireAllowedOrigin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { origin } = req.headers;
  if (!origin) {
    return res.status(400).send('unknown origin');
  }

  const permitted = ALLOWED_ORIGINS.includes(origin);
  console.info(
    `checking if ${sanitizeForLog(origin)} is whitelisted ${permitted}`
  );
  if (!permitted) {
    return res.status(403).end();
  }
  console.info(`permitted access to ${origin}`);
  res.set('Access-Control-Allow-Origin', origin);

  const database = getDatabase();
  const authService = new AuthenticationService(
    new TokenRepository(database),
    new UsersRepository(database)
  );

  await configureUserLocal(req, res, authService, database);

  return next();
};

export default RequireAllowedOrigin;
