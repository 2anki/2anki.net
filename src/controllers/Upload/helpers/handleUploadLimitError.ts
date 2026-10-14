import express from 'express';
import { getDefaultEmailService } from '../../../services/EmailService/EmailService';
import UsersService from '../../../services/UsersService';
import UsersRepository from '../../../data_layer/UsersRepository';
import { getDatabase } from '../../../data_layer';
import SubscriptionService from '../../../services/SubscriptionService';
import {
  getStripe,
  updateStoreSubscription,
} from '../../../lib/integrations/stripe';
import type StripeTypes from 'stripe';

function determineLimitKind(
  error: Error | null | undefined
): 'file_size' | 'card_count' {
  if (error?.message?.includes('You can only add 100 cards')) {
    return 'card_count';
  }
  return 'file_size';
}

export const handleUploadLimitError = async (
  req: express.Request,
  response: express.Response,
  error?: Error | null
) => {
  const owner = response.locals.owner;
  const kind = determineLimitKind(error);

  if (owner) {
    const database = getDatabase();
    const emailService = getDefaultEmailService();
    const usersService = new UsersService(
      new UsersRepository(database),
      emailService
    );

    const user = await usersService.getUserById(response.locals.owner);
    if (user) {
      try {
        const activeSubs =
          await SubscriptionService.findActiveStripeSubscriptions(user.email);
        if (activeSubs.length > 0) {
          const stripe = getStripe();
          for (const sub of activeSubs) {
            const customer = (await stripe.customers.retrieve(
              sub.customer as string
            )) as StripeTypes.Customer;
            await updateStoreSubscription(database, customer, sub);
          }
          return response.redirect('/upload');
        }
      } catch (err) {
        console.error('[handleUploadLimitError] Stripe sync failed:', err);
      }
      return response.redirect(`/limit?kind=${kind}`);
    }
  }

  response.redirect(`/limit?kind=${kind}`);
};
