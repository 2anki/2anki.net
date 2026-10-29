import { getUserLocals } from '../backend/getUserLocals';

export class AccountUnreadError extends Error {
  constructor() {
    super('The account read came back with no account data');
    this.name = 'AccountUnreadError';
  }
}

// One read of the account with no retries, kept out of the shared account
// cache: pages that redirect on sign-in (home, landing) must not move because
// of it. Only the caller sees the answer. A read that comes back empty (a
// redirect) says nothing about the session, so it fails instead of reading as
// signed out.
export async function readUserLocalsOnce() {
  const locals = await getUserLocals();
  if (locals == null) throw new AccountUnreadError();
  return locals;
}
