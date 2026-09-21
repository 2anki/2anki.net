import { isPPTFile } from '../../lib/storage/checks';
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
