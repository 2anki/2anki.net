import {
  BlockObjectResponse,
  EquationBlockObjectResponse,
  LinkPreviewBlockObjectResponse,
  ListBlockChildrenResponse,
  PdfBlockObjectResponse,
  SyncedBlockBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IBlockRenderer } from '../BlockHandler/types';
import { BlockCallout } from '../blocks/BlockCallout';
import { BlockChildPage } from '../blocks/BlockChildPage';
import BlockCode from '../blocks/BlockCode';
import { BlockDivider } from '../blocks/BlockDivider';
import { renderDisplayEquation } from '../blocks/BlockEquation';
import { BlockHeading } from '../blocks/BlockHeadings';
import BlockParagraph from '../blocks/BlockParagraph';
import { BlockQuote } from '../blocks/BlockQuote';
import LinkToPage from '../blocks/LinkToPage/LinkToPage';
import { BlockBulletList } from '../blocks/lists/BlockBulletList';
import BlockColumnList from '../blocks/lists/BlockColumnList';
import { BlockNumberedList } from '../blocks/lists/BlockNumberedList';
import { BlockTable } from '../blocks/lists/BlockTable';
import { BlockTodoList } from '../blocks/lists/BlockTodoList';
import { BlockToggleList } from '../blocks/lists/BlockToggleList';
import BlockBookmark from '../blocks/media/BlockBookmark';
import { BlockEmbed } from '../blocks/media/BlockEmbed';
import { BlockVideo } from '../blocks/media/BlockVideo';

const renderPdfLink = (url: string): string =>
  renderToStaticMarkup(
    <a href={url} target="_blank" rel="noopener noreferrer">
      {url}
    </a>
  );

const renderPdf = async (
  c: PdfBlockObjectResponse,
  handler: IBlockRenderer
): Promise<string> => {
  const url = c.pdf.type === 'file' ? c.pdf.file.url : c.pdf.external.url;
  if (!url) {
    return '';
  }
  if (handler.settings.downloadPdfs && c.pdf.type === 'file') {
    return handler.embedFile(c);
  }
  return renderPdfLink(url);
};

const renderLinkPreview = (c: LinkPreviewBlockObjectResponse): string => {
  const url = c.link_preview.url;
  if (!url) {
    return '';
  }
  return renderToStaticMarkup(
    <a href={url} target="_blank" rel="noopener noreferrer">
      {url}
    </a>
  );
};

const renderSyncedBlock = async (
  c: SyncedBlockBlockObjectResponse,
  handler: IBlockRenderer
): Promise<string> => {
  if (c.has_children) {
    const children = await handler.getBackSide(c, true);
    if (children) {
      return children;
    }
  }
  return renderToStaticMarkup(
    <aside className="synced-block-empty">Synced block</aside>
  );
};

export const blockToStaticMarkup = async (
  handler: IBlockRenderer,
  c: BlockObjectResponse,
  response?: ListBlockChildrenResponse
) => {
  let back = '';
  switch (c.type) {
    case 'image':
      const image = await handler.embedImage(c);
      back += image;
      break;
    case 'audio':
      const audio = await handler.embedAudioFile(c);
      back += audio;
      break;
    case 'file':
      const file = await handler.embedFile(c);
      back += file;
      break;
    case 'paragraph':
      back += BlockParagraph(c, handler);
      break;
    case 'code':
      back += BlockCode(c, handler);
      break;
    case 'heading_1':
      back += await BlockHeading('heading_1', c, handler);
      break;
    case 'heading_2':
      back += await BlockHeading('heading_2', c, handler);
      break;
    case 'heading_3':
      back += await BlockHeading('heading_3', c, handler);
      break;
    case 'heading_4':
      back += await BlockHeading('heading_4', c, handler);
      break;
    case 'quote':
      back += BlockQuote(c, handler);
      break;
    case 'divider':
      back += BlockDivider();
      break;
    case 'child_page':
      back += await BlockChildPage(c, handler);
      break;
    case 'to_do':
      back += await BlockTodoList(c, response, handler);
      break;
    case 'callout':
      back += await BlockCallout(c, handler);
      break;
    case 'bulleted_list_item':
      back += await BlockBulletList(c, response, handler);
      break;
    case 'numbered_list_item':
      back += await BlockNumberedList(c, response, handler);
      break;
    case 'toggle':
      back += await BlockToggleList(c, handler);
      break;
    case 'bookmark':
      back += await BlockBookmark(c, handler);
      break;
    case 'video':
      back += BlockVideo(c, handler);
      break;
    case 'embed':
      back += BlockEmbed(c, handler);
      break;
    case 'column_list':
      back += await BlockColumnList(c, handler);
      break;
    case 'equation':
      back += renderDisplayEquation(c as EquationBlockObjectResponse);
      break;
    case 'link_to_page':
      back += await LinkToPage(c, handler);
      break;
    case 'table':
      back += await BlockTable(c, handler);
      break;
    case 'table_row':
      break;
    case 'synced_block':
      back += await renderSyncedBlock(c, handler);
      break;
    case 'pdf':
      back += await renderPdf(c, handler);
      break;
    case 'link_preview':
      back += renderLinkPreview(c);
      break;
    default:
      handler.recordUnsupportedBlockType(c.type);
      console.debug(`unsupported ${c.type}`);
  }
  return back;
};
