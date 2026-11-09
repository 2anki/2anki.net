import { renderToStaticMarkup } from 'react-dom/server';
import { getUploadLimits } from '../../misc/getUploadLimits';
import { decompress } from './decompress';
import { File, RecoveryBudget } from './types';
import { ZipRecoveryTooLargeError } from './ZipRecoveryTooLargeError';
import { isZipContentFileSupported } from '../../../usecases/uploads/isZipContentFileSupported';

export const processAndPrepareArchiveData = async (
  byteArray: Uint8Array,
  isPatron: boolean,
  budget: RecoveryBudget
) => {
  const size = Buffer.byteLength(byteArray);
  const limits = getUploadLimits(isPatron);

  if (size > limits.fileSize) {
    throw new Error(
      renderToStaticMarkup(
        <>
          Your upload is too big, there is a max of {size} / ${limits.fileSize}{' '}
          currently. <a href="https://alemayhu.com/patreon">Become a patron</a>{' '}
          to remove default limit or{' '}
          <a href="https://2anki.net/login#login">login</a>.
        </>
      )
    );
  }

  const decompressedData = await decompress(byteArray, budget);
  const files: File[] = [];
  let textBytes = 0;

  for (const file of decompressedData) {
    if (isZipContentFileSupported(file.name)) {
      textBytes += file.size ?? 0;
      if (textBytes > budget.maxTextBytes) {
        throw new ZipRecoveryTooLargeError();
      }
      const contents = new TextDecoder().decode(file.contents as Uint8Array);
      files.push({ name: file.name, contents });
    } else {
      files.push(file);
    }
  }

  return files;
};
