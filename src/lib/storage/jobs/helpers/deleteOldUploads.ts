import { Knex } from 'knex';

import { CLEANUP_AGE_SECONDS } from '../../../constants';
import StorageHandler from '../../StorageHandler';
import { deleteNonSubScriberUploadsInDatabase } from './deleteNonSubScriberUploadsInDatabase';
import { deleteDanglingUploadsInBucket } from './deleteDanglingUploadsInBucket';
import { deleteDeadUploadRowsInDatabase } from './deleteDeadUploadRowsInDatabase';

export const MS_21 = CLEANUP_AGE_SECONDS * 1000;
export const MS_24_HOURS = 1000 * 60 * 60 * 24;

export function safeParseAttachments(val: unknown): string[] {
  if (val == null) return [];
  if (Array.isArray(val))
    return val.filter((x): x is string => typeof x === 'string');
  if (typeof val !== 'string') return [];
  const trimmed = val.trim();
  if (trimmed === '') return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

const deleteResolvedFeedbackAttachments = async (
  db: Knex,
  storage: StorageHandler
) => {
  const resolvedFeedback = await db('feedback')
    .select('attachments', 'id')
    .where('is_acknowledged', true);

  for (const feedback of resolvedFeedback) {
    const attachments = safeParseAttachments(feedback.attachments);
    if (
      attachments.length === 0 &&
      feedback.attachments != null &&
      feedback.attachments !== ''
    ) {
      console.warn('feedback row has unparseable attachments', {
        rowId: feedback.id,
        valueType: typeof feedback.attachments,
      });
    }
    for (const attachment of attachments) {
      await storage.delete(attachment);
    }
  }

  await db('feedback').where('is_acknowledged', true).delete();
};

export default async function deleteOldUploads(db: Knex) {
  const storage = new StorageHandler();
  await deleteNonSubScriberUploadsInDatabase(db, storage);
  await deleteDanglingUploadsInBucket(db, storage);
  await deleteDeadUploadRowsInDatabase(db, storage);
  await deleteResolvedFeedbackAttachments(db, storage);
}
