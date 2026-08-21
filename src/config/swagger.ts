import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '2anki Server API',
      version: '2.0.0',
      description:
        'API documentation for 2anki server - Convert content to Anki flashcards',
      contact: {
        name: '2anki',
        url: 'https://github.com/2anki/server',
      },
    },
    servers: [
      {
        url:
          process.env.NODE_ENV === 'production'
            ? 'https://2anki.net/'
            : 'http://localhost:2020',
        description:
          process.env.NODE_ENV === 'production'
            ? 'Production server'
            : 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'session',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message',
            },
            message: {
              type: 'string',
              description: 'Detailed error description',
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Success message',
            },
          },
        },
        Version: {
          type: 'object',
          properties: {
            version: {
              type: 'string',
              description: 'Current API version',
            },
            build: {
              type: 'string',
              description: 'Build information',
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'User ID',
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Account creation timestamp',
            },
          },
        },
        NotionPage: {
          type: 'object',
          properties: {
            object: {
              type: 'string',
              enum: ['page'],
              description: 'Object type',
            },
            id: {
              type: 'string',
              description: 'Page ID',
            },
            created_time: {
              type: 'string',
              format: 'date-time',
              description: 'Page creation timestamp',
            },
            last_edited_time: {
              type: 'string',
              format: 'date-time',
              description: 'Last edited timestamp',
            },
            created_by: {
              $ref: '#/components/schemas/NotionUser',
            },
            last_edited_by: {
              $ref: '#/components/schemas/NotionUser',
            },
            cover: {
              oneOf: [
                { $ref: '#/components/schemas/NotionFile' },
                { type: 'null' },
              ],
            },
            icon: {
              oneOf: [
                { $ref: '#/components/schemas/NotionIcon' },
                { type: 'null' },
              ],
            },
            parent: {
              $ref: '#/components/schemas/NotionParent',
            },
            archived: {
              type: 'boolean',
              description: 'Whether the page is archived',
            },
            properties: {
              type: 'object',
              additionalProperties: true,
              description: 'Page properties',
            },
            url: {
              type: 'string',
              format: 'uri',
              description: 'Page URL',
            },
            public_url: {
              oneOf: [{ type: 'string', format: 'uri' }, { type: 'null' }],
              description: 'Public page URL',
            },
          },
          required: [
            'object',
            'id',
            'created_time',
            'last_edited_time',
            'created_by',
            'last_edited_by',
            'parent',
            'archived',
            'properties',
            'url',
          ],
        },
        NotionDatabase: {
          type: 'object',
          properties: {
            object: {
              type: 'string',
              enum: ['database'],
              description: 'Object type',
            },
            id: {
              type: 'string',
              description: 'Database ID',
            },
            created_time: {
              type: 'string',
              format: 'date-time',
              description: 'Database creation timestamp',
            },
            last_edited_time: {
              type: 'string',
              format: 'date-time',
              description: 'Last edited timestamp',
            },
            created_by: {
              $ref: '#/components/schemas/NotionUser',
            },
            last_edited_by: {
              $ref: '#/components/schemas/NotionUser',
            },
            title: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/NotionRichText',
              },
              description: 'Database title',
            },
            description: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/NotionRichText',
              },
              description: 'Database description',
            },
            icon: {
              oneOf: [
                { $ref: '#/components/schemas/NotionIcon' },
                { type: 'null' },
              ],
            },
            cover: {
              oneOf: [
                { $ref: '#/components/schemas/NotionFile' },
                { type: 'null' },
              ],
            },
            properties: {
              type: 'object',
              additionalProperties: true,
              description: 'Database properties/schema',
            },
            parent: {
              $ref: '#/components/schemas/NotionParent',
            },
            url: {
              type: 'string',
              format: 'uri',
              description: 'Database URL',
            },
            archived: {
              type: 'boolean',
              description: 'Whether the database is archived',
            },
            is_inline: {
              type: 'boolean',
              description: 'Whether the database is inline',
            },
            public_url: {
              oneOf: [{ type: 'string', format: 'uri' }, { type: 'null' }],
              description: 'Public database URL',
            },
          },
          required: [
            'object',
            'id',
            'created_time',
            'last_edited_time',
            'created_by',
            'last_edited_by',
            'title',
            'description',
            'properties',
            'parent',
            'url',
            'archived',
            'is_inline',
          ],
        },
        NotionUser: {
          type: 'object',
          properties: {
            object: {
              type: 'string',
              enum: ['user'],
              description: 'Object type',
            },
            id: {
              type: 'string',
              description: 'User ID',
            },
            type: {
              type: 'string',
              enum: ['person', 'bot'],
              description: 'User type',
            },
            name: {
              type: 'string',
              description: 'User name',
            },
            avatar_url: {
              oneOf: [{ type: 'string', format: 'uri' }, { type: 'null' }],
              description: 'User avatar URL',
            },
          },
          required: ['object', 'id'],
        },
        NotionIcon: {
          type: 'object',
          oneOf: [
            {
              properties: {
                type: { type: 'string', enum: ['emoji'] },
                emoji: { type: 'string' },
              },
              required: ['type', 'emoji'],
            },
            {
              properties: {
                type: { type: 'string', enum: ['external'] },
                external: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', format: 'uri' },
                  },
                  required: ['url'],
                },
              },
              required: ['type', 'external'],
            },
            {
              properties: {
                type: { type: 'string', enum: ['file'] },
                file: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    expiry_time: { type: 'string', format: 'date-time' },
                  },
                  required: ['url', 'expiry_time'],
                },
              },
              required: ['type', 'file'],
            },
          ],
        },
        NotionFile: {
          type: 'object',
          oneOf: [
            {
              properties: {
                type: { type: 'string', enum: ['external'] },
                external: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', format: 'uri' },
                  },
                  required: ['url'],
                },
              },
              required: ['type', 'external'],
            },
            {
              properties: {
                type: { type: 'string', enum: ['file'] },
                file: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    expiry_time: { type: 'string', format: 'date-time' },
                  },
                  required: ['url', 'expiry_time'],
                },
              },
              required: ['type', 'file'],
            },
          ],
        },
        NotionParent: {
          type: 'object',
          oneOf: [
            {
              properties: {
                type: { type: 'string', enum: ['database_id'] },
                database_id: { type: 'string' },
              },
              required: ['type', 'database_id'],
            },
            {
              properties: {
                type: { type: 'string', enum: ['page_id'] },
                page_id: { type: 'string' },
              },
              required: ['type', 'page_id'],
            },
            {
              properties: {
                type: { type: 'string', enum: ['workspace'] },
                workspace: { type: 'boolean' },
              },
              required: ['type', 'workspace'],
            },
            {
              properties: {
                type: { type: 'string', enum: ['block_id'] },
                block_id: { type: 'string' },
              },
              required: ['type', 'block_id'],
            },
          ],
        },
        NotionRichText: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['text', 'mention', 'equation'],
              description: 'Rich text type',
            },
            text: {
              type: 'object',
              properties: {
                content: { type: 'string' },
                link: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        url: { type: 'string', format: 'uri' },
                      },
                      required: ['url'],
                    },
                    { type: 'null' },
                  ],
                },
              },
            },
            annotations: {
              type: 'object',
              properties: {
                bold: { type: 'boolean' },
                italic: { type: 'boolean' },
                strikethrough: { type: 'boolean' },
                underline: { type: 'boolean' },
                code: { type: 'boolean' },
                color: { type: 'string' },
              },
              required: [
                'bold',
                'italic',
                'strikethrough',
                'underline',
                'code',
                'color',
              ],
            },
            plain_text: {
              type: 'string',
              description: 'Plain text content',
            },
            href: {
              oneOf: [{ type: 'string', format: 'uri' }, { type: 'null' }],
              description: 'Link URL',
            },
          },
          required: ['type', 'plain_text'],
        },
        NotionSearchResults: {
          type: 'object',
          properties: {
            object: {
              type: 'string',
              enum: ['list'],
              description: 'Object type',
            },
            results: {
              type: 'array',
              items: {
                oneOf: [
                  { $ref: '#/components/schemas/NotionPage' },
                  { $ref: '#/components/schemas/NotionDatabase' },
                ],
              },
              description: 'Search results',
            },
            next_cursor: {
              oneOf: [{ type: 'string' }, { type: 'null' }],
              description: 'Cursor for next page of results',
            },
            has_more: {
              type: 'boolean',
              description: 'Whether there are more results',
            },
            type: {
              type: 'string',
              enum: ['page_or_database'],
              description: 'Type of search results',
            },
            page_or_database: {
              type: 'object',
              description: 'Search metadata',
            },
          },
          required: ['object', 'results', 'has_more', 'type'],
        },
        NotionObject: {
          type: 'object',
          description: 'Simplified Notion object for frontend consumption',
          properties: {
            object: {
              type: 'string',
              description: 'Object type (page or database)',
            },
            title: {
              type: 'string',
              description: 'Object title',
            },
            url: {
              type: 'string',
              format: 'uri',
              description: 'Object URL',
            },
            icon: {
              type: 'string',
              description: 'Object icon (emoji or URL)',
            },
            id: {
              type: 'string',
              description: 'Object ID',
            },
            data: {
              oneOf: [
                { $ref: '#/components/schemas/NotionPage' },
                { $ref: '#/components/schemas/NotionDatabase' },
              ],
              description: 'Full object data',
            },
            isFavorite: {
              type: 'boolean',
              description: 'Whether the object is favorited',
            },
          },
          required: ['object', 'title', 'url', 'id'],
        },
        Upload: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Upload ID',
            },
            filename: {
              type: 'string',
              description: 'Original filename',
            },
            size: {
              type: 'integer',
              description: 'File size in bytes',
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Upload timestamp',
            },
          },
        },
        ChatBasicCard: {
          type: 'object',
          description:
            'Basic two-sided flashcard. Front and back are both required strings.',
          required: ['front', 'back'],
          properties: {
            front: { type: 'string' },
            back: { type: 'string' },
            tags: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 8,
              description:
                'Optional subject tags. Each tag is normalised server-side to lower-case kebab-case.',
            },
          },
        },
        ChatMcqCard: {
          type: 'object',
          description:
            'Multiple-choice flashcard. On `/api/chat/deck` requests, `back` may be omitted — the server derives it from `options[correctIndex]`. On `/api/chat/message` `done` frames, `back` is emitted as an empty string.',
          required: ['front', 'options', 'correctIndex'],
          properties: {
            front: { type: 'string' },
            back: {
              type: 'string',
              description:
                'Always emitted as an empty string in `done` frames. Optional in `/api/chat/deck` requests.',
            },
            options: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: { type: 'string' },
              description: 'Exactly 4 non-empty option strings.',
            },
            correctIndex: {
              type: 'integer',
              minimum: 0,
              maximum: 3,
              description: 'Index into `options` of the correct answer.',
            },
            rationale: {
              type: 'string',
              description: 'Optional short explanation of the correct answer.',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              maxItems: 8,
            },
          },
        },
        ChatTokenFrame: {
          type: 'object',
          description:
            'SSE frame emitted as `event: token`. `data` is a JSON string fragment of the assistant reply.',
          properties: {
            event: { type: 'string', enum: ['token'] },
            data: {
              type: 'string',
              description: 'JSON-encoded string fragment.',
            },
          },
          required: ['event', 'data'],
        },
        ChatDoneFrame: {
          type: 'object',
          description:
            'SSE frame emitted as `event: done`. Terminal frame on success.',
          properties: {
            event: { type: 'string', enum: ['done'] },
            data: {
              type: 'object',
              required: ['content', 'conversationId'],
              properties: {
                content: {
                  type: 'string',
                  description:
                    'Full assistant reply, also reconstructable by concatenating `token` frames.',
                },
                conversationId: {
                  type: 'integer',
                  description:
                    'Conversation id the message was persisted under. Returned even for first-turn requests where the caller did not send one.',
                },
                cards: {
                  type: 'array',
                  description:
                    'Generated flashcards, when the assistant produced them. Each entry is either a basic card or an MCQ card — clients must handle both shapes.',
                  items: {
                    oneOf: [
                      { $ref: '#/components/schemas/ChatBasicCard' },
                      { $ref: '#/components/schemas/ChatMcqCard' },
                    ],
                  },
                },
                contentBefore: {
                  type: 'string',
                  description: 'Prose that appeared before the cards block.',
                },
                contentAfter: {
                  type: 'string',
                  description: 'Prose that appeared after the cards block.',
                },
              },
            },
          },
          required: ['event', 'data'],
        },
        ChatErrorFrame: {
          type: 'object',
          description:
            'SSE frame emitted as `event: error`. Terminal frame on failure. HTTP status remains 200 — branch on `data.type`.',
          properties: {
            event: { type: 'string', enum: ['error'] },
            data: {
              oneOf: [
                {
                  type: 'object',
                  description:
                    'Caller has not yet recorded chat consent (POST /api/chat/consent).',
                  required: ['type'],
                  properties: {
                    type: { type: 'string', enum: ['consent_required'] },
                  },
                },
                {
                  type: 'object',
                  description:
                    'The `conversationId` in the request does not belong to the caller or does not exist.',
                  required: ['type'],
                  properties: {
                    type: { type: 'string', enum: ['conversation_not_found'] },
                  },
                },
                {
                  type: 'object',
                  description:
                    'The MCQ template could not produce well-formed multiple-choice cards. Surface a specific message; do not silently fall back to the previous turn.',
                  required: ['type'],
                  properties: {
                    type: { type: 'string', enum: ['mcq_extraction_failed'] },
                  },
                },
                {
                  type: 'object',
                  description: 'Unhandled server error; safe to retry.',
                  required: ['type'],
                  properties: {
                    type: { type: 'string', enum: ['server_error'] },
                  },
                },
              ],
            },
          },
          required: ['event', 'data'],
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
      {
        cookieAuth: [],
      },
    ],
  },
  apis: ['./src/routes/*.ts', './src/controllers/*.ts'],
};

/**
 * @swagger
 * components:
 *   x-middleware:
 *     authentication:
 *       description: |
 *         All authenticated endpoints require either:
 *         - Bearer token in Authorization header
 *         - Valid session cookie
 *       behaviors:
 *         - Validates JWT tokens
 *         - Checks session cookies
 *         - Returns 401 if invalid/missing
 *     originValidation:
 *       description: |
 *         Public upload endpoints validate request origin
 *       behaviors:
 *         - Checks Origin/Referer headers
 *         - Validates against whitelist
 *         - Returns 403 if not allowed
 *     paidSubscription:
 *       description: |
 *         Premium features require active subscription
 *       behaviors:
 *         - Validates subscription status
 *         - Returns 403 if subscription expired
 */

export const swaggerSpec = swaggerJsdoc(options);

// Custom CSS for swagger UI
export const swaggerUiOptions = {
  customCss: `
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info .title { color: #3b82f6; }
  `,
  customSiteTitle: '2anki API Documentation',
  customfavIcon: '/favicon.ico',
};
