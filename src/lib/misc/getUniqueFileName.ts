import crypto from 'crypto';

/**
 * We create a hash from the input to avoid name conflicts
 * and invalid characters due to language encoding.
 * @param input user supplied filename
 * @returns hex digest
 */
const getUniqueFileName = (input: string | Buffer, max: number = 100) => {
  const shasum = crypto.createHash('sha512');
  shasum.update(input);
  return shasum.digest('hex').slice(0, max);
};

export default getUniqueFileName;
