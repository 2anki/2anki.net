import { isCompressedFile, isPPTFile } from '../../lib/storage/checks';
import { isZipContentFileSupported } from './isZipContentFileSupported';

export function isPartialDeliveryEligible(
  files: { originalname: string }[] | undefined
): boolean {
  if (files == null || files.length !== 1) {
    return false;
  }
  const name = files[0].originalname;
  return isZipContentFileSupported(name) || Boolean(isPPTFile(name));
}

export function isAnonymousPartialDeliveryEligible(
  files: { originalname: string }[] | undefined
): boolean {
  if (files == null || files.length !== 1) {
    return false;
  }
  if (isPartialDeliveryEligible(files)) {
    return true;
  }
  return isCompressedFile(files[0].originalname);
}
