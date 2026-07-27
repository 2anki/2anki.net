// Keys written by features that own their own lifecycle. The dangling sweep
// walks the whole bucket, so without this it would delete every mindmap image
// and image-occlusion draft on its first pass — those keys are never in the
// uploads table and so can never appear in its keep-set.
// 'assets/' is written by the deploy workflow's `aws s3 sync`, not by the app,
// so no uploads row will ever reference it and --size-only leaves its
// LastModified old enough to defeat the grace window. Whether it lands in this
// bucket depends on SPACES_ASSETS_BUCKET, which is a CI secret we cannot read
// from here — the bucket holds no assets/ objects today, but the previous
// sweep would have deleted them either way, so absence proves nothing.
export const RESERVED_KEY_PREFIXES = [
  'mindmaps/',
  'io-drafts/',
  'assets/',
] as const;

// An object is only orphaned once its owning row has had time to commit. A
// deck is uploaded to storage before its uploads row is written, so a sweep
// running in that gap would delete a file that is about to be referenced.
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export interface BucketObject {
  Key?: string;
  LastModified?: Date;
}

export function isReservedKey(key: string): boolean {
  return RESERVED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// True only for a key that no table references and that is old enough to be a
// genuine orphan rather than an in-flight write.
export function isDeletableBucketKey(
  object: BucketObject,
  referencedKeys: ReadonlySet<string>,
  now: Date = new Date()
): boolean {
  const key = object.Key;
  if (key == null || key.length === 0) {
    return false;
  }
  if (isReservedKey(key)) {
    return false;
  }
  if (referencedKeys.has(key)) {
    return false;
  }
  const lastModified = object.LastModified;
  if (lastModified == null) {
    // No age to reason about — leave it alone rather than guess.
    return false;
  }
  return now.getTime() - lastModified.getTime() > ORPHAN_GRACE_MS;
}
