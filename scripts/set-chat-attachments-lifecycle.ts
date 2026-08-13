import 'dotenv/config';

import {
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
  type LifecycleRule,
} from '@aws-sdk/client-s3';

import { normalizeS3Endpoint } from '../src/lib/storage/normalizeS3Endpoint';

const RULE_ID = 'expire-chat-attachments-90d';
const CHAT_ATTACHMENTS_PREFIX = 'chat-attachments/';
const EXPIRE_AFTER_DAYS = 90;

const lifecycleRule: LifecycleRule = {
  ID: RULE_ID,
  Status: 'Enabled',
  Filter: { Prefix: CHAT_ATTACHMENTS_PREFIX },
  Expiration: { Days: EXPIRE_AFTER_DAYS },
  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
};

async function getExistingRules(
  s3: S3Client,
  bucket: string
): Promise<LifecycleRule[]> {
  try {
    const current = await s3.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })
    );
    return current.Rules ?? [];
  } catch (error) {
    if ((error as { name?: string }).name === 'NoSuchLifecycleConfiguration') {
      return [];
    }
    throw error;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const bucket = process.env.SPACES_DEFAULT_BUCKET_NAME;
  if (!bucket) {
    throw new Error('SPACES_DEFAULT_BUCKET_NAME is not set');
  }

  const s3 = new S3Client({
    endpoint: normalizeS3Endpoint(process.env.SPACES_ENDPOINT),
    region: process.env.SPACES_REGION ?? 'us-east-1',
  });

  const existingRules = await getExistingRules(s3, bucket);
  console.log(
    `Current lifecycle rules on ${bucket}:\n${JSON.stringify(existingRules, null, 2)}`
  );

  const mergedRules = [
    ...existingRules.filter((rule) => rule.ID !== RULE_ID),
    lifecycleRule,
  ];
  console.log(
    `Rules after merge:\n${JSON.stringify(mergedRules, null, 2)}`
  );

  if (!apply) {
    console.log('Dry run — pass --apply to write this configuration.');
    return;
  }

  await s3.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: { Rules: mergedRules },
    })
  );

  const verifiedRules = await getExistingRules(s3, bucket);
  const applied = verifiedRules.some((rule) => rule.ID === RULE_ID);
  if (!applied) {
    throw new Error(`Rule ${RULE_ID} missing after put — inspect the bucket.`);
  }
  console.log(`Applied. ${RULE_ID} is live on ${bucket}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
