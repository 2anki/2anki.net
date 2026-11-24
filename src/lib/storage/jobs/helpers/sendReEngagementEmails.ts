import crypto from 'node:crypto';

import type { IReEngagementRepository } from '../../../../data_layer/ReEngagementRepository';
import type { IEmailService } from '../../../../services/EmailService/EmailService';
import { normalizeEmail } from '../../../email/isValidEmailShape';

export async function sendReEngagementEmails(
  repo: IReEngagementRepository,
  emailService: IEmailService
): Promise<{ count: number }> {
  const users = await repo.getUsersToEmail();
  const reachable = users.flatMap((user) => {
    const address = normalizeEmail(user.email);
    return address == null ? [] : [{ ...user, address }];
  });
  const unreachableCount = users.length - reachable.length;
  if (unreachableCount > 0) {
    console.info(
      `[re-engagement] skipped ${unreachableCount} account(s) without a valid email address`
    );
  }

  let count = 0;
  for (const user of reachable) {
    const token = crypto.randomBytes(32).toString('hex');
    await repo.recordSend(user.id, token);
    try {
      await emailService.sendReEngagementEmail(user.address, user.name, token);
      count++;
    } catch (error) {
      console.error(`[re-engagement] failed to email user ${user.id}:`, error);
    }
  }

  return { count };
}
