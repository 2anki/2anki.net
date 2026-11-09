import i18n from '../../../lib/i18n';
import { stripHtmlTags } from '../../../lib/text/stripHtmlTags';
import type { UploadErrorBody } from '../../../types/UploadErrorBody';
import { formatAcceptedFormats } from '../../../pages/UploadPage/helpers/getAcceptedContentTypes';

export type ErrorHandlerType = (error: unknown) => void;

interface FriendlyError {
  title: string;
  detail?: string;
  actionLink?: { text: string; to: string };
}

function tr(
  key: string,
  fallback: string,
  values?: Record<string, unknown>
): string {
  return i18n.t(`errors:${key}`, { defaultValue: fallback, ...values });
}

const FALLBACK = (): FriendlyError => ({
  title: tr('messages.fallback.title', 'Something went wrong.'),
  detail: tr(
    'messages.fallback.detail',
    'Try again. If the problem keeps happening, email support@2anki.net.'
  ),
});

const UPLOAD_FALLBACK = (): FriendlyError => ({
  title: tr(
    'messages.uploadFallback.title',
    'Something broke while reading this file.'
  ),
  detail: tr(
    'messages.uploadFallback.detail',
    'Try again, or send the file to support@2anki.net so we can fix the parser.'
  ),
});

function toText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return '';
}

const NOTION_UNAUTHORIZED = (): FriendlyError => ({
  title: tr(
    'messages.notionUnauthorized.title',
    'Your Notion connection expired'
  ),
  detail: tr(
    'messages.notionUnauthorized.detail',
    'Sign in to Notion again to keep converting your pages.'
  ),
  actionLink: {
    text: tr('messages.notionUnauthorized.action', 'Reconnect Notion'),
    to: '/notion',
  },
});

function httpMeta(error: unknown): { status?: number; url?: string } {
  if (error != null && typeof error === 'object') {
    const e = error as { status?: unknown; url?: unknown };
    return {
      status: typeof e.status === 'number' ? e.status : undefined,
      url: typeof e.url === 'string' ? e.url : undefined,
    };
  }
  return {};
}

export function isNotionUnauthorized(error: unknown): boolean {
  if (error != null && typeof error === 'object' && 'code' in error) {
    return (error as { code: unknown }).code === 'notion_unauthorized';
  }
  const raw = toText(error).toLowerCase();
  return raw.includes('api token is invalid');
}

export function classifyError(error: unknown): FriendlyError {
  if (isNotionUnauthorized(error)) return NOTION_UNAUTHORIZED();

  const raw = toText(error);

  if (!raw) return FALLBACK();

  const lower = raw.toLowerCase();

  if (
    error instanceof TypeError ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed')
  ) {
    return {
      title: tr('messages.network.title', "Couldn't reach 2anki."),
      detail: tr(
        'messages.network.detail',
        'Check your connection and try again.'
      ),
    };
  }

  if (
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('econnrefused') ||
    lower.includes('gateway_timeout') ||
    lower.includes('service_unavailable')
  ) {
    return {
      title: tr(
        'messages.serviceUnavailable.title',
        'The service is unreachable right now.'
      ),
      detail: tr(
        'messages.serviceUnavailable.detail',
        'This is usually temporary — try again in a moment.'
      ),
    };
  }

  if (lower.includes('rate_limited') || lower.includes('429')) {
    return {
      title: tr('messages.rateLimited.title', 'Too many requests.'),
      detail: tr('messages.rateLimited.detail', 'Try again in a minute.'),
    };
  }

  if (
    lower.includes('unauthorized') ||
    lower.includes('401') ||
    lower.includes('authentication required')
  ) {
    return {
      title: tr('messages.sessionExpired.title', 'Session expired.'),
      detail: tr(
        'messages.sessionExpired.detail',
        'Sign in again to continue.'
      ),
      actionLink: {
        text: tr('messages.sessionExpired.action', 'Sign in'),
        to: '/login',
      },
    };
  }

  const { status, url } = httpMeta(error);

  if (
    (status === 404 || lower.includes('404')) &&
    url?.startsWith('/api/apkg/')
  ) {
    return {
      title: tr('messages.apkgGone.title', 'This deck is no longer available.'),
      detail: tr(
        'messages.apkgGone.detail',
        'Uploaded decks are removed after a while. Convert or upload it again to preview it.'
      ),
      actionLink: {
        text: tr('messages.apkgGone.action', 'Back to My decks'),
        to: '/downloads',
      },
    };
  }

  if (lower.includes('object_not_found') || lower.includes('404')) {
    return {
      title: tr(
        'messages.notionPageNotFound.title',
        "We couldn't open that Notion page."
      ),
      detail: tr(
        'messages.notionPageNotFound.detail',
        "It may have been deleted, or it's no longer shared with 2anki. Share it again in Notion, or pick a different page."
      ),
      actionLink: {
        text: tr('messages.notionPageNotFound.action', 'Choose a page'),
        to: '/notion',
      },
    };
  }

  if (lower.includes('upload_limit') || lower.includes('upload limit')) {
    return {
      title: tr(
        'messages.monthlyLimit.title',
        "You've reached your monthly limit."
      ),
      detail: tr(
        'messages.monthlyLimit.detail',
        'Upgrade your plan to convert more decks this month.'
      ),
    };
  }

  const stripped = stripHtmlTags(raw);
  if (stripped.length > 0 && stripped.length < 280) {
    return { title: stripped };
  }

  return FALLBACK();
}

export const getErrorMessage = (error: unknown): string => {
  const friendly = classifyError(error);
  return friendly.detail
    ? `${friendly.title} ${friendly.detail}`
    : friendly.title;
};

const UPLOAD_CODE_DEFAULTS: Partial<
  Record<UploadErrorBody['code'], FriendlyError>
> = {
  unsupported_format: {
    title: "This file type isn't supported.",
    detail: 'Use {{formats}}.',
  },
  too_large: {
    title: 'This file is too large to convert in one go.',
    detail: 'Split it into smaller files and convert each one separately.',
  },
  password_protected_pdf: {
    title: 'This PDF is password-protected.',
    detail:
      'Remove the password in your PDF reader, save a copy, and upload that.',
  },
  invalid_markup: {
    title: "Part of this file has formatting we couldn't read.",
    detail:
      'Open the source, remove or simplify the block that broke, and try again.',
  },
  malformed_notion: {
    title: "This Notion database uses a view we don't support yet.",
    detail:
      'Convert the parent page, or switch the database to a different view and try again.',
  },
  corrupted_apkg: {
    title: 'This .apkg file is damaged.',
    detail: 'Re-export it from Anki, or send it to support@2anki.net.',
  },
  empty_export: {
    title: 'This export has no content we can turn into cards.',
    detail: 'Check the page has text or toggle blocks, then export again.',
  },
  markdown_likely_lossy: {
    title:
      'Notion Markdown exports flatten toggles — re-export this page as HTML and the toggles become flashcards.',
  },
  claude_parse_failed: {
    title: 'Something went wrong while making your cards.',
    detail: 'Try again — if it keeps happening, email support@2anki.net.',
  },
  parser_crash: {
    title: "Couldn't read this file.",
    detail:
      "It may be malformed or use a structure we don't recognise yet. Try re-exporting from the source app, or send the file to support@2anki.net.",
  },
  worker_timeout: {
    title: 'This conversion took longer than the time budget.',
    detail:
      'Try splitting the file into smaller pieces, or remove very large embedded images.',
  },
  notion_rate_limit: {
    title: 'Notion is rate-limiting us right now.',
    detail: 'Wait a minute and convert again.',
  },
  notion_unavailable: {
    title: 'Notion is having trouble right now.',
    detail: 'Try again in a minute.',
  },
  notion_object_not_found: {
    title: "We couldn't open that Notion page.",
    detail: 'Share it with the 2anki integration in Notion, then try again.',
  },
  apkg_too_large_for_anki: {
    title: "This deck is over Anki's upload limit.",
    detail:
      'Split it by toggling fewer pages, or upload directly to Anki desktop.',
  },
  zip_invalid: {
    title: "Couldn't read this zip.",
    detail:
      "Make sure it's the Markdown & CSV export from Notion, not the HTML export.",
  },
  deck_builder_crash: {
    title: 'Something broke on our end building this deck.',
    detail: 'Try again. If it keeps failing, email support@2anki.net.',
  },
  claude_refusal: {
    title: 'Claude declined to make cards from this file.',
    detail:
      'If you added user instructions for PDF conversion, remove them under PDF & AI in Settings and try again. If it keeps happening, email support@2anki.net.',
  },
  ai_credits_exhausted: {
    title: "You're out of AI credits.",
    detail:
      'AI credits come back when your allowance resets. Turn off Claude cards to convert now with the standard parser.',
  },
};

function localizeUploadCode(
  code: UploadErrorBody['code'],
  defaults: FriendlyError
): FriendlyError {
  const localized: FriendlyError = {
    title: tr(`upload.${code}.title`, defaults.title),
  };
  if (defaults.detail !== undefined) {
    const values =
      code === 'unsupported_format'
        ? { formats: formatAcceptedFormats(i18n.language) }
        : undefined;
    localized.detail = tr(`upload.${code}.detail`, defaults.detail, values);
  }
  return localized;
}

const NOTION_TOO_LARGE_TITLE = 'This export is too large to convert in one go.';
const NOTION_TOO_LARGE_DETAIL =
  'Split it into smaller Notion subpages and convert each one separately.';

// A Notion page job that ran out of room splits into subpages, not files.
export function classifyNotionTooLarge(): FriendlyError {
  return {
    title: tr('upload.too_large_notion.title', NOTION_TOO_LARGE_TITLE),
    detail: tr('upload.too_large_notion.detail', NOTION_TOO_LARGE_DETAIL),
  };
}

// A Map so a setting off the wire can never reach an Object.prototype key.
const SETTING_TOO_LONG = new Map<string, FriendlyError>(
  Object.entries({
    user_instructions: {
      title: 'Your user instructions for PDF conversion are too long.',
      detail: 'Shorten them under PDF & AI in Settings, then upload again.',
    },
    deck_name: {
      title: 'Your saved deck name is too long.',
      detail: 'Shorten it under Deck name in Settings, then upload again.',
    },
    other: {
      title:
        'A setting saved in this browser is too long to send with your upload.',
      detail: 'Open Settings, choose Reset to defaults, and upload again.',
    },
  })
);

function classifySettingTooLong(
  setting: UploadErrorBody['setting']
): FriendlyError {
  const key =
    setting != null && SETTING_TOO_LONG.has(setting) ? setting : 'other';
  const defaults = SETTING_TOO_LONG.get(key) as FriendlyError;
  return {
    title: tr(`upload.setting_too_long.${key}.title`, defaults.title),
    detail: tr(`upload.setting_too_long.${key}.detail`, defaults.detail ?? ''),
  };
}

type PageRange = NonNullable<UploadErrorBody['page_range']>;

// One entry per sentence the server can say about a page range; past_end
// reads differently for one page and a run of pages, and both take the plural
// form of the PDF's page count.
const PAGE_RANGE = new Map<string, FriendlyError>(
  Object.entries({
    too_long: {
      title: 'That page range is too long.',
      detail: 'Keep it under {{max}} characters.',
    },
    too_many_parts: {
      title: 'That is too many page ranges.',
      detail: 'Use at most {{max}}.',
    },
    number_too_large: {
      title: "'{{part}}' has a page number that is too large.",
      detail: 'Use page numbers from your PDF, like 12-30, 45.',
    },
    range_starts_at_zero: {
      title: "Page numbers start at 1, so '{{part}}' is not a valid range.",
    },
    backwards: {
      title: "'{{part}}' goes backwards.",
      detail: 'Write the lower page first, like {{lower}}-{{upper}}.',
    },
    page_zero: {
      title: "Page numbers start at 1, so '{{part}}' is not a valid page.",
    },
    invalid_part: {
      title: "'{{part}}' is not a valid page or range.",
      detail: 'Use page numbers and ranges like 12-30, 45.',
    },
    past_end_page: {
      title: 'Page {{first}} is past the end of this {{pageCount}}-page PDF.',
    },
    past_end_pages: {
      title:
        'Pages {{first}}-{{last}} are past the end of this {{pageCount}}-page PDF.',
    },
    locked_pdf: {
      title: "Page ranges don't work on password-protected PDFs.",
      detail: 'Convert again without a page range to use the whole file.',
    },
    split_timeout: {
      title: 'That PDF took too long to split into the pages you asked for.',
      detail: 'Try fewer pages.',
    },
  })
);

function pageRangeKey(details: PageRange): string {
  if (details.reason !== 'past_end') return details.reason;
  return details.first === details.last ? 'past_end_page' : 'past_end_pages';
}

function classifyPageRange(details: PageRange): FriendlyError | null {
  const key = pageRangeKey(details);
  const defaults = PAGE_RANGE.get(key);
  if (defaults == null) return null;
  const { reason: _reason, ...rest } = details;
  const values =
    details.reason === 'past_end'
      ? { ...rest, count: details.pageCount }
      : rest;
  const localized: FriendlyError = {
    title: tr(`upload.pdf_page_range.${key}.title`, defaults.title, values),
  };
  if (defaults.detail !== undefined) {
    localized.detail = tr(
      `upload.pdf_page_range.${key}.detail`,
      defaults.detail,
      values
    );
  }
  return localized;
}

export function classifyUploadError(body: UploadErrorBody): FriendlyError {
  if (body.code === 'setting_too_long') {
    return classifySettingTooLong(body.setting);
  }
  if (body.code === 'pdf_page_range' && body.page_range != null) {
    const pageRange = classifyPageRange(body.page_range);
    if (pageRange != null) return pageRange;
  }
  const defaults = UPLOAD_CODE_DEFAULTS[body.code];
  if (defaults) return localizeUploadCode(body.code, defaults);
  const stripped = stripHtmlTags(body.message);
  if (stripped.length > 0 && stripped.length < 280) {
    return { title: stripped };
  }
  return UPLOAD_FALLBACK();
}
