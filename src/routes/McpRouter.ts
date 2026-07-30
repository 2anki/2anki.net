import { RequestHandler } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { getDatabase } from '../data_layer';
import JobRepository from '../data_layer/JobRepository';
import UploadRepository from '../data_layer/UploadRespository';
import UsersRepository from '../data_layer/UsersRepository';
import SettingsRepository from '../data_layer/SettingsRepository';
import { ConversionOutputStatsRepository } from '../data_layer/ConversionOutputStatsRepository';
import { ParsePathSignatureRepository } from '../data_layer/ParsePathSignatureRepository';
import { ConversionRuleScoresRepository } from '../data_layer/ConversionRuleScoresRepository';
import { CardGuidLedgerRepository } from '../data_layer/CardGuidLedgerRepository';
import TokenRepository from '../data_layer/TokenRepository';
import DownloadRepository from '../data_layer/DownloadRepository';
import { McpOAuthClientRepository } from '../data_layer/McpOAuthClientRepository';
import { McpAuthorizationCodeRepository } from '../data_layer/McpAuthorizationCodeRepository';
import { McpTokenRepository } from '../data_layer/McpTokenRepository';
import StorageHandler from '../lib/storage/StorageHandler';
import UploadService from '../services/UploadService';
import DownloadService from '../services/DownloadService';
import ApkgPreviewService from '../services/ApkgPreviewService/ApkgPreviewService';
import AuthenticationService from '../services/AuthenticationService';
import { KnexOAuthProvider } from '../services/mcp/oauth/KnexOAuthProvider';
import { McpToolsService } from '../services/mcp/McpToolsService';
import { McpDeckPersistence } from '../services/mcp/McpDeckPersistence';
import { buildMcpServer } from '../services/mcp/McpServerFactory';
import { PhotoToFlashcardsUseCase } from '../usecases/imageOcclusion/PhotoToFlashcardsUseCase';
import { EventsRepository } from '../data_layer/EventsRepository';
import { applyUserLocals } from './middleware/configureUserLocal';
import { getEventsSink } from '../services/events/eventsSinkInstance';
import { createMcpRouter, MCP_AUTHORIZE_PATH } from './mcp/createMcpRouter';

function resolveIssuerUrl(): URL {
  return new URL(process.env.MCP_ISSUER_URL ?? 'https://2anki.net');
}

const McpRouter = () => {
  const database = getDatabase();
  const issuerUrl = resolveIssuerUrl();
  const resourceUrl = new URL('/mcp', issuerUrl);
  const consentSecret = process.env.SECRET ?? '';

  const usersRepository = new UsersRepository(database);
  const authService = new AuthenticationService(
    new TokenRepository(database),
    usersRepository
  );

  const provider = new KnexOAuthProvider({
    clientRepo: new McpOAuthClientRepository(database),
    codeRepo: new McpAuthorizationCodeRepository(database),
    tokenRepo: new McpTokenRepository(database),
    authService,
    usersRepo: usersRepository,
    config: {
      resourceUrl,
      loginPath: '/login',
      authorizePath: MCP_AUTHORIZE_PATH,
      consentSecret,
    },
  });

  const uploadService = new UploadService(
    new UploadRepository(database),
    new JobRepository(database),
    usersRepository,
    new SettingsRepository(database),
    new ConversionOutputStatsRepository(database),
    new ParsePathSignatureRepository(database),
    undefined,
    undefined,
    new ConversionRuleScoresRepository(database),
    new CardGuidLedgerRepository(database)
  );
  const storage = new StorageHandler();
  const toolsService = new McpToolsService(
    new JobRepository(database),
    new DownloadService(new DownloadRepository(database)),
    new ApkgPreviewService(),
    (req, res) => uploadService.handleUpload(req, res),
    storage,
    new McpDeckPersistence(
      new JobRepository(database),
      new UploadRepository(database),
      storage
    ),
    new PhotoToFlashcardsUseCase(new EventsRepository(database)),
    usersRepository
  );

  const onAuthenticatedPost: RequestHandler = async (req, res) => {
    const ownerValue = req.auth?.extra?.owner;
    if (ownerValue == null) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    const owner = String(ownerValue);
    const user = await usersRepository.getById(owner);
    if (user == null) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    await applyUserLocals(
      res,
      { ...user, owner: user.id },
      authService,
      database
    );

    const server = buildMcpServer({
      owner,
      locals: res.locals,
      toolsService,
      recordToolCall: (toolName) =>
        getEventsSink().record({
          name: 'mcp_tool_called',
          user_id: Number(user.id),
          anonymous_id: null,
          props: { tool: toolName },
          created_at: new Date(),
        }),
      recordToolResult: (toolName, success, errorCode, extraProps) =>
        getEventsSink().record({
          name: 'mcp_tool_result',
          user_id: Number(user.id),
          anonymous_id: null,
          props: {
            tool: toolName,
            success,
            ...(errorCode != null ? { error_code: errorCode } : {}),
            ...extraProps,
          },
          created_at: new Date(),
        }),
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  return createMcpRouter({
    provider,
    issuerUrl,
    resourceUrl,
    onAuthenticatedPost,
    consentSecret,
  });
};

export default McpRouter;
