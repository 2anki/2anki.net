/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

export interface Error {
  /** Error message */
  error?: string;
  /** Detailed error description */
  message?: string;
}

export interface Success {
  /** Success message */
  message?: string;
}

export interface Version {
  /** Current API version */
  version?: string;
  /** Build information */
  build?: string;
}

export interface User {
  /** User ID */
  id?: number;
  /**
   * User email address
   * @format email
   */
  email?: string;
  /**
   * Account creation timestamp
   * @format date-time
   */
  created_at?: string;
}

export interface NotionPage {
  /** Object type */
  object: "page";
  /** Page ID */
  id: string;
  /**
   * Page creation timestamp
   * @format date-time
   */
  created_time: string;
  /**
   * Last edited timestamp
   * @format date-time
   */
  last_edited_time: string;
  created_by: NotionUser;
  last_edited_by: NotionUser;
  cover?: NotionFile | null;
  icon?: NotionIcon | null;
  parent: NotionParent;
  /** Whether the page is archived */
  archived: boolean;
  /** Page properties */
  properties: Record<string, any>;
  /**
   * Page URL
   * @format uri
   */
  url: string;
  /** Public page URL */
  public_url?: string | null;
}

export interface NotionDatabase {
  /** Object type */
  object: "database";
  /** Database ID */
  id: string;
  /**
   * Database creation timestamp
   * @format date-time
   */
  created_time: string;
  /**
   * Last edited timestamp
   * @format date-time
   */
  last_edited_time: string;
  created_by: NotionUser;
  last_edited_by: NotionUser;
  /** Database title */
  title: NotionRichText[];
  /** Database description */
  description: NotionRichText[];
  icon?: NotionIcon | null;
  cover?: NotionFile | null;
  /** Database properties/schema */
  properties: Record<string, any>;
  parent: NotionParent;
  /**
   * Database URL
   * @format uri
   */
  url: string;
  /** Whether the database is archived */
  archived: boolean;
  /** Whether the database is inline */
  is_inline: boolean;
  /** Public database URL */
  public_url?: string | null;
}

export interface NotionUser {
  /** Object type */
  object: "user";
  /** User ID */
  id: string;
  /** User type */
  type?: "person" | "bot";
  /** User name */
  name?: string;
  /** User avatar URL */
  avatar_url?: string | null;
}

export type NotionIcon =
  | {
      type: "emoji";
      emoji: string;
    }
  | {
      type: "external";
      external: {
        /** @format uri */
        url: string;
      };
    }
  | {
      type: "file";
      file: {
        /** @format uri */
        url: string;
        /** @format date-time */
        expiry_time: string;
      };
    };

export type NotionFile =
  | {
      type: "external";
      external: {
        /** @format uri */
        url: string;
      };
    }
  | {
      type: "file";
      file: {
        /** @format uri */
        url: string;
        /** @format date-time */
        expiry_time: string;
      };
    };

export type NotionParent =
  | {
      type: "database_id";
      database_id: string;
    }
  | {
      type: "page_id";
      page_id: string;
    }
  | {
      type: "workspace";
      workspace: boolean;
    }
  | {
      type: "block_id";
      block_id: string;
    };

export interface NotionRichText {
  /** Rich text type */
  type: "text" | "mention" | "equation";
  text?: {
    content?: string;
    link?: {
      /** @format uri */
      url: string;
    } | null;
  };
  annotations?: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
  /** Plain text content */
  plain_text: string;
  /** Link URL */
  href?: string | null;
}

export interface NotionSearchResults {
  /** Object type */
  object: "list";
  /** Search results */
  results: (NotionPage | NotionDatabase)[];
  /** Cursor for next page of results */
  next_cursor?: string | null;
  /** Whether there are more results */
  has_more: boolean;
  /** Type of search results */
  type: "page_or_database";
  /** Search metadata */
  page_or_database?: object;
}

/** Simplified Notion object for frontend consumption */
export interface NotionObject {
  /** Object type (page or database) */
  object: string;
  /** Object title */
  title: string;
  /**
   * Object URL
   * @format uri
   */
  url: string;
  /** Object icon (emoji or URL) */
  icon?: string;
  /** Object ID */
  id: string;
  /** Full object data */
  data?: NotionPage | NotionDatabase;
  /** Whether the object is favorited */
  isFavorite?: boolean;
}

export interface Upload {
  /** Upload ID */
  id?: number;
  /** Original filename */
  filename?: string;
  /** File size in bytes */
  size?: number;
  /**
   * Upload timestamp
   * @format date-time
   */
  created_at?: string;
}

/** Basic two-sided flashcard. Front and back are both required strings. */
export interface ChatBasicCard {
  front: string;
  back: string;
  /**
   * Optional subject tags. Each tag is normalised server-side to lower-case kebab-case.
   * @maxItems 8
   */
  tags?: string[];
}

/** Multiple-choice flashcard. On `/api/chat/deck` requests, `back` may be omitted — the server derives it from `options[correctIndex]`. On `/api/chat/message` `done` frames, `back` is emitted as an empty string. */
export interface ChatMcqCard {
  front: string;
  /** Always emitted as an empty string in `done` frames. Optional in `/api/chat/deck` requests. */
  back?: string;
  /**
   * Exactly 4 non-empty option strings.
   * @maxItems 4
   * @minItems 4
   */
  options: string[];
  /**
   * Index into `options` of the correct answer.
   * @min 0
   * @max 3
   */
  correctIndex: number;
  /** Optional short explanation of the correct answer. */
  rationale?: string;
  /** @maxItems 8 */
  tags?: string[];
}

/** SSE frame emitted as `event: token`. `data` is a JSON string fragment of the assistant reply. */
export interface ChatTokenFrame {
  event: "token";
  /** JSON-encoded string fragment. */
  data: string;
}

/** SSE frame emitted as `event: done`. Terminal frame on success. */
export interface ChatDoneFrame {
  event: "done";
  data: {
    /** Full assistant reply, also reconstructable by concatenating `token` frames. */
    content: string;
    /** Conversation id the message was persisted under. Returned even for first-turn requests where the caller did not send one. */
    conversationId: number;
    /** Generated flashcards, when the assistant produced them. Each entry is either a basic card or an MCQ card — clients must handle both shapes. */
    cards?: (ChatBasicCard | ChatMcqCard)[];
    /** Prose that appeared before the cards block. */
    contentBefore?: string;
    /** Prose that appeared after the cards block. */
    contentAfter?: string;
  };
}

/** SSE frame emitted as `event: error`. Terminal frame on failure. HTTP status remains 200 — branch on `data.type`. */
export interface ChatErrorFrame {
  event: "error";
  /** Caller has not yet recorded chat consent (POST /api/chat/consent). */
  data:
    | {
        type: "consent_required";
      }
    | {
        type: "conversation_not_found";
      }
    | {
        type: "mcq_extraction_failed";
      }
    | {
        type: "server_error";
      };
}
