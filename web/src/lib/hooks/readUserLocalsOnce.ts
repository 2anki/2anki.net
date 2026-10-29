import { getUserLocals } from '../backend/getUserLocals';

// One read of the account with no retries, kept out of the shared account
// cache: pages that redirect on sign-in (home, landing) must not move while an
// upload they started is still being sent. Only the caller sees the answer.
export function readUserLocalsOnce() {
  return getUserLocals();
}
