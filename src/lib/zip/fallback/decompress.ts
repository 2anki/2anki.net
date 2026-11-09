import { unpack, UnpackLimits } from './unpack';
import { File } from './types';
import { writeFile } from './writeFile';

export function decompress(
  byteArray: Uint8Array,
  limits: Pick<UnpackLimits, 'maxBytes' | 'timeoutMs'>
): Promise<File[]> {
  const { workspace, filePath } = writeFile(byteArray);
  return unpack(filePath, workspace.location, limits);
}
