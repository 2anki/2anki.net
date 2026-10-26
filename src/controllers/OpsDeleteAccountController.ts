import express from 'express';
import type {
  DeleteAccountByEmailUseCase,
  DeleteAccountOutcome,
} from '../usecases/ops/DeleteAccountByEmailUseCase';

const respond = (res: express.Response, outcome: DeleteAccountOutcome) => {
  switch (outcome.status) {
    case 'not_found':
      res.status(404).json({ message: 'No account found for that email.' });
      return;
    case 'own_account':
      res
        .status(409)
        .json({ message: "You can't delete your own account from here." });
      return;
    case 'preview':
      res.status(200).json({ dryRun: true, account: outcome.account });
      return;
    case 'paid':
      res.status(409).json({
        code: 'paid',
        message:
          'This account has paid access. Tick "Delete even though it has paid access" to go ahead.',
        account: outcome.account,
      });
      return;
    case 'billing_failed':
      res.status(502).json({
        message:
          "Couldn't cancel the Stripe subscription, so nothing was deleted. Try again in a minute.",
      });
      return;
    case 'deleted':
      res.status(200).json({ dryRun: false, userId: outcome.userId });
  }
};

class OpsDeleteAccountController {
  constructor(
    private readonly useCase: Pick<DeleteAccountByEmailUseCase, 'execute'>
  ) {}

  async deleteAccount(req: express.Request, res: express.Response) {
    const { email, confirmEmail, dryRun, force } = (req.body ?? {}) as {
      email?: unknown;
      confirmEmail?: unknown;
      dryRun?: unknown;
      force?: unknown;
    };
    const trimmed = typeof email === 'string' ? email.trim() : '';
    if (!trimmed.includes('@')) {
      res.status(400).json({ message: 'A valid account email is required.' });
      return;
    }
    // Anything but an explicit false is a preview, so a missing flag can
    // never delete.
    const isDryRun = dryRun !== false;
    const confirmed =
      typeof confirmEmail === 'string' &&
      confirmEmail.trim().toLowerCase() === trimmed.toLowerCase();
    if (!isDryRun && !confirmed) {
      res
        .status(400)
        .json({ message: 'Type the account email again to confirm.' });
      return;
    }

    try {
      const outcome = await this.useCase.execute({
        email: trimmed,
        dryRun: isDryRun,
        force: force === true,
        operatorId: Number(res.locals.owner),
      });
      respond(res, outcome);
    } catch (error) {
      console.error('[ops] delete-user failed', error);
      res.status(500).json({ message: 'Failed to delete the account.' });
    }
  }
}

export default OpsDeleteAccountController;
