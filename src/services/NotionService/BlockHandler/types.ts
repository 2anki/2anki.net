import type {
  AudioBlockObjectResponse,
  BlockObjectResponse,
  FileBlockObjectResponse,
  PdfBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

import type CardOption from '../../../lib/parser/Settings';
import type TagRegistry from '../../../lib/parser/TagRegistry';
import type NotionAPIWrapper from '../NotionAPIWrapper';

/**
 * The surface block renderers and helpers need from BlockHandler. They
 * receive the instance by parameter; typing against this interface instead of
 * the class keeps blocks/ and helpers/ out of BlockHandler's module cycle.
 */
export interface IBlockRenderer {
  api: NotionAPIWrapper;
  settings: CardOption;
  skip: string[];
  useAll: boolean;
  tagRegistry: TagRegistry;
  readonly unsupportedBlockTypes: string[];
  recordUnsupportedBlockType(type: string): void;
  getBackSide(
    block: BlockObjectResponse,
    handleChildren?: boolean
  ): Promise<string | null>;
  embedImage(c: BlockObjectResponse): Promise<string>;
  embedAudioFile(c: AudioBlockObjectResponse): Promise<string>;
  embedFile(
    block: FileBlockObjectResponse | PdfBlockObjectResponse
  ): Promise<string>;
}
