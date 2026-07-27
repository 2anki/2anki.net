import express from 'express';
import { getDatabase } from '../../data_layer';
import { sendIndex } from './sendIndex';
import { getDefaultEmailService } from '../../services/EmailService/EmailService';
import {
  shouldSendContactAck,
  CONTACT_ACK_COOLDOWN_MS,
} from '../../lib/email/shouldSendContactAck';
import { normalizeEmail } from '../../lib/email/isValidEmailShape';

class IndexController {
  public getIndex(_request: express.Request, response: express.Response) {
    sendIndex(response);
  }

  async contactUs(req: express.Request, res: express.Response) {
    const { name, email, message } = req.body;
    console.info('Contact Us', name, email, message);
    if (!email || !message) {
      return res.status(400).send({ error: 'Missing email or message' });
    }

    const attachments = Array.isArray(req.files) ? req.files : [];
    const database = getDatabase();

    const inserted = await database('feedback')
      .insert({
        name,
        email,
        message,
        attachments: JSON.stringify(attachments.map((a) => a.originalname)),
      })
      .returning('id');
    const feedbackId =
      typeof inserted?.[0] === 'object' ? inserted[0]?.id : inserted?.[0];

    const emailService = getDefaultEmailService();
    void emailService
      .sendContactEmail(name, email, message, attachments)
      .then((result) => {
        if (!result.didSend) {
          console.error(
            `Contact email notification failed for feedback row ${feedbackId}; the message is saved in the ops inbox`,
            result.error
          );
        }
      })
      .catch((err) => {
        console.error(
          `Contact email notification threw for feedback row ${feedbackId}; the message is saved in the ops inbox`,
          err
        );
      });

    // One normalized address drives the cooldown lookup AND the recipient —
    // if they could differ, padding or a "display <addr>" wrapper would mint a
    // fresh cooldown key while still delivering to the same mailbox.
    const normalizedEmail = normalizeEmail(email);
    const windowStart = new Date(Date.now() - CONTACT_ACK_COOLDOWN_MS);
    const recentRows = await database('feedback')
      .whereRaw('lower(btrim(email)) = ?', [normalizedEmail ?? ''])
      .where('created_at', '>', windowStart)
      .count<{ count: string | number }[]>('* as count');
    const recentCount = Number(recentRows?.[0]?.count ?? 0);

    if (shouldSendContactAck(normalizedEmail, message, recentCount)) {
      void emailService
        .sendContactConfirmationEmail(normalizedEmail as string)
        .catch((err) => {
          console.error(
            `Contact confirmation email failed for feedback row ${feedbackId}; submission unaffected`,
            err
          );
        });
    }

    return res.status(200).send();
  }
}

export default IndexController;
