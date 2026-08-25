import crypto from 'node:crypto';

import { AnkifyClient } from '../../entities/ankify';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifySessionTokensRepositoryInterface } from '../../data_layer/ankify/AnkifySessionTokensRepository';

export const ANKIFY_RAC_BASE_IMAGE = 'remote-anki-client:latest';

const ANKI_PORT_RANGE: PortRange = { start: 20000, end: 21000 };
const NOVNC_PORT_RANGE: PortRange = { start: 22000, end: 23000 };

const CONTAINER_INTERNAL_ANKI_PORT = 8765;
const CONTAINER_INTERNAL_NOVNC_PORT = 6081;

const CONTAINER_MEMORY_BYTES = 1536 * 1024 * 1024;
const CONTAINER_CPU_QUOTA = 50_000;
const CONTAINER_CPU_PERIOD = 100_000;

const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_TTL_HOURS = 8;
const HOST_LOOPBACK = '127.0.0.1';

const ANKICONNECT_API_KEY_BYTES = 32;
const HARDENED_CAPS_DROP = ['ALL'] as const;
const HARDENED_SECURITY_OPT = ['no-new-privileges:true'] as const;
const HARDENED_TMPFS = {
  '/tmp': 'rw,nosuid,nodev,size=128m',
  '/var/run': 'rw,nosuid,nodev,size=8m',
  '/run/user/1000': 'rw,nosuid,nodev,size=32m',
} as const;

interface PortRange {
  start: number;
  end: number;
}

interface DockerPort {
  PublicPort?: number;
}

interface DockerContainerSummary {
  Ports?: DockerPort[];
}

export interface DockerContainerLike {
  id: string;
  start(): Promise<unknown>;
  inspect(): Promise<{ Name?: string } | { Name: string }>;
  stop(): Promise<unknown>;
  remove(opts?: { force?: boolean }): Promise<unknown>;
}

export interface DockerLike {
  listContainers(opts?: { all?: boolean }): Promise<DockerContainerSummary[]>;
  createContainer(opts: unknown): Promise<DockerContainerLike>;
  getContainer(id: string): DockerContainerLike;
}

export class DockerUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Docker daemon is unavailable');
    this.name = 'DockerUnavailableError';
    if (cause instanceof Error) {
      this.stack = cause.stack;
    }
  }
}

export class NoAvailablePortError extends Error {
  constructor() {
    super('No available port in the configured range');
    this.name = 'NoAvailablePortError';
  }
}

export interface AnkifyClientView extends AnkifyClient {
  session_url: string | null;
  has_active_session: boolean;
}

export interface ProvisionResult {
  client: AnkifyClientView;
  created: boolean;
}

export class RacService {
  constructor(
    private readonly repo: AnkifyClientsRepositoryInterface,
    private readonly docker: DockerLike,
    private readonly tokens: AnkifySessionTokensRepositoryInterface,
    private readonly baseImage: string = ANKIFY_RAC_BASE_IMAGE,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async provision(owner: number): Promise<ProvisionResult> {
    console.info('[ankify-provision] start owner=%d', owner);
    let existing: AnkifyClient | null;
    try {
      existing = await this.repo.findActiveByOwner(owner);
    } catch (error) {
      console.error('[ankify-provision] findActiveByOwner failed:', error);
      throw error;
    }
    if (existing != null) {
      console.info(
        '[ankify-provision] returning existing client id=%d container=%s',
        existing.id,
        existing.container_id
      );
      const hasActive = await this.hasActiveSession(existing.id);
      return {
        client: {
          ...existing,
          session_url: null,
          has_active_session: hasActive,
        },
        created: false,
      };
    }

    let usedPorts: Set<number>;
    try {
      usedPorts = await this.collectUsedPorts();
      console.info(
        '[ankify-provision] used ports collected count=%d',
        usedPorts.size
      );
    } catch (error) {
      console.error('[ankify-provision] collectUsedPorts failed:', error);
      throw error;
    }

    let ankiPort: number;
    let novncPort: number;
    try {
      ankiPort = pickPort(ANKI_PORT_RANGE, usedPorts);
      novncPort = pickPort(NOVNC_PORT_RANGE, usedPorts);
      console.info(
        '[ankify-provision] picked ports anki=%d novnc=%d',
        ankiPort,
        novncPort
      );
    } catch (error) {
      console.error('[ankify-provision] pickPort failed:', error);
      throw error;
    }

    const ankiConnectApiKey = generateAnkiConnectApiKey();

    let container: DockerContainerLike;
    try {
      console.info(
        '[ankify-provision] creating container image=%s',
        this.baseImage
      );
      container = await this.createAndStartContainer(
        ankiPort,
        novncPort,
        ankifyVolumeNameForOwner(owner),
        ankiConnectApiKey
      );
      console.info('[ankify-provision] container started id=%s', container.id);
    } catch (error) {
      console.error(
        '[ankify-provision] createAndStartContainer failed:',
        error
      );
      throw error;
    }

    let containerName: string | null;
    try {
      const inspect = await container.inspect();
      containerName = stripLeadingSlash(inspect.Name);
      console.info(
        '[ankify-provision] inspect ok name=%s',
        containerName ?? 'null'
      );
    } catch (error) {
      console.warn('[ankify-provision] inspect failed (non-fatal):', error);
      containerName = null;
    }

    let client: AnkifyClient;
    try {
      client = await this.repo.create({
        owner,
        container_id: container.id,
        container_name: containerName,
        anki_port: ankiPort,
        vnc_port: 0,
        novnc_port: novncPort,
        anki_connect_api_key: ankiConnectApiKey,
      });
      console.info(
        '[ankify-provision] persisted row id=%d for owner=%d',
        client.id,
        owner
      );
    } catch (error) {
      console.error(
        '[ankify-provision] repo.create failed — attempting to stop the orphan container:',
        error
      );
      try {
        await container.stop();
        await container.remove({ force: true });
      } catch (cleanupError) {
        console.error(
          '[ankify-provision] orphan cleanup failed:',
          cleanupError
        );
      }
      throw error;
    }

    const sessionUrl = await this.mintSessionUrl(client);

    return {
      client: { ...client, session_url: sessionUrl, has_active_session: true },
      created: true,
    };
  }

  async respin(owner: number): Promise<ProvisionResult> {
    const existing = await this.repo.findActiveByOwner(owner);
    if (existing == null) {
      return this.provision(owner);
    }

    try {
      const oldContainer = this.docker.getContainer(existing.container_id);
      await oldContainer.stop().catch(() => undefined);
      await oldContainer.remove({ force: true }).catch(() => undefined);
    } catch {
      // Container might already be gone; proceed to create the new one.
    }
    await this.repo.deleteById(existing.id);

    const usedPorts = await this.collectUsedPorts();
    const ankiPort = pickPort(ANKI_PORT_RANGE, usedPorts);
    const novncPort = pickPort(NOVNC_PORT_RANGE, usedPorts);
    const ankiConnectApiKey = generateAnkiConnectApiKey();

    const container = await this.createAndStartContainer(
      ankiPort,
      novncPort,
      ankifyVolumeNameForOwner(owner),
      ankiConnectApiKey
    );
    const inspect = await container.inspect().catch(() => ({}));
    const containerName = stripLeadingSlash(
      (inspect as { Name?: string }).Name
    );

    const client = await this.repo.create({
      owner,
      container_id: container.id,
      container_name: containerName,
      anki_port: ankiPort,
      vnc_port: 0,
      novnc_port: novncPort,
      anki_connect_api_key: ankiConnectApiKey,
    });

    const sessionUrl = await this.mintSessionUrl(client);

    return {
      client: { ...client, session_url: sessionUrl, has_active_session: true },
      created: true,
    };
  }

  async reapIdle(thresholdMs: number): Promise<{ stopped: number[] }> {
    const cutoff = new Date(this.clock().getTime() - thresholdMs);
    const idleClients = await this.repo.listIdleSince(cutoff);
    const stopped: number[] = [];
    for (const client of idleClients) {
      try {
        const container = this.docker.getContainer(client.container_id);
        await container.stop().catch(() => undefined);
        await container.remove({ force: true }).catch(() => undefined);
        await this.repo.deleteById(client.id);
        stopped.push(client.id);
      } catch (error) {
        if (error instanceof DockerUnavailableError) {
          break;
        }
      }
    }
    return { stopped };
  }

  async list(owner: number): Promise<AnkifyClientView[]> {
    const clients = await this.repo.listByOwner(owner);
    const reconciled: AnkifyClientView[] = [];
    for (const client of clients) {
      if (client.status !== 'active') {
        reconciled.push({
          ...client,
          session_url: null,
          has_active_session: false,
        });
        continue;
      }
      try {
        const container = this.docker.getContainer(client.container_id);
        await container.inspect();
        const hasActive = await this.hasActiveSession(client.id);
        reconciled.push({
          ...client,
          session_url: null,
          has_active_session: hasActive,
        });
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404) {
          await this.repo.deleteById(client.id);
        } else {
          console.warn(
            `[ankify] reconcile skipped for container ${client.container_id}:`,
            (error as Error).message ?? error
          );
          const hasActive = await this.hasActiveSession(client.id);
          reconciled.push({
            ...client,
            session_url: null,
            has_active_session: hasActive,
          });
        }
      }
    }
    return reconciled;
  }

  async reissueSessionUrl(
    id: number,
    owner: number
  ): Promise<AnkifyClientView | null> {
    const client = await this.repo.findActiveById(id, owner);
    if (client == null) {
      return null;
    }
    const sessionUrl = await this.mintSessionUrl(client);
    return { ...client, session_url: sessionUrl, has_active_session: true };
  }

  private async hasActiveSession(clientId: number): Promise<boolean> {
    const row = await this.tokens.findActiveByClientId(clientId);
    return row != null;
  }

  async stop(id: number, owner: number): Promise<void> {
    const client = await this.repo.findActiveById(id, owner);
    if (client == null) {
      return;
    }

    const container = this.docker.getContainer(client.container_id);
    try {
      await container.stop();
    } catch {
      // Container already stopped, removed, or unreachable — proceed to delete.
    }
    try {
      await container.remove({ force: true });
    } catch {
      // Same as above; AutoRemove may have already cleaned up.
    }

    await this.tokens.revokeByClientId(client.id);
    await this.repo.deleteById(id);
  }

  async resolveTokenForProxy(plaintext: string): Promise<{
    ankify_client_id: number;
    owner: number;
    novnc_port: number;
    token_id: number;
  } | null> {
    const tokenHash = hashToken(plaintext);
    const token = await this.tokens.findActiveByHash(tokenHash);
    if (token == null) {
      return null;
    }
    const client = await this.repo.findActiveById(
      token.ankify_client_id,
      token.owner
    );
    if (client == null) {
      return null;
    }
    return {
      ankify_client_id: token.ankify_client_id,
      owner: token.owner,
      novnc_port: client.novnc_port,
      token_id: token.id,
    };
  }

  async touchTokenLastUsed(tokenId: number): Promise<void> {
    await this.tokens.touchLastUsed(tokenId);
  }

  private async mintSessionUrl(client: AnkifyClient): Promise<string> {
    const plaintext = generateTokenPlaintext();
    const tokenHash = hashToken(plaintext);
    const expiresAt = new Date(
      this.clock().getTime() + SESSION_TOKEN_TTL_HOURS * 60 * 60 * 1000
    );
    await this.tokens.insert({
      ankify_client_id: client.id,
      owner: client.owner,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    return buildSessionUrl(plaintext, client.novnc_port);
  }

  private async collectUsedPorts(): Promise<Set<number>> {
    const used = new Set<number>();
    let containers: DockerContainerSummary[];
    try {
      containers = await this.docker.listContainers({ all: false });
      console.info(
        '[ankify-provision] docker.listContainers ok count=%d',
        containers.length
      );
    } catch (error) {
      console.error('[ankify-provision] docker.listContainers threw:', error);
      throw new DockerUnavailableError(error);
    }

    for (const summary of containers) {
      if (summary.Ports == null) {
        continue;
      }
      for (const port of summary.Ports) {
        if (port.PublicPort != null) {
          used.add(port.PublicPort);
        }
      }
    }

    try {
      const reserved = await this.repo.reservedPorts();
      console.info(
        '[ankify-provision] db reserved ports count=%d',
        reserved.length
      );
      for (const port of reserved) {
        used.add(port);
      }
    } catch (error) {
      console.error('[ankify-provision] repo.reservedPorts threw:', error);
      throw error;
    }
    return used;
  }

  private async createAndStartContainer(
    ankiPort: number,
    novncPort: number,
    volumeName: string,
    ankiConnectApiKey: string
  ): Promise<DockerContainerLike> {
    const createOpts = {
      Image: this.baseImage,
      Env: [`ANKICONNECT_API_KEY=${ankiConnectApiKey}`],
      ExposedPorts: {
        [`${CONTAINER_INTERNAL_ANKI_PORT}/tcp`]: {},
        [`${CONTAINER_INTERNAL_NOVNC_PORT}/tcp`]: {},
      },
      HostConfig: {
        AutoRemove: true,
        Memory: CONTAINER_MEMORY_BYTES,
        CpuQuota: CONTAINER_CPU_QUOTA,
        CpuPeriod: CONTAINER_CPU_PERIOD,
        CapDrop: [...HARDENED_CAPS_DROP],
        SecurityOpt: [...HARDENED_SECURITY_OPT],
        Tmpfs: { ...HARDENED_TMPFS },
        Mounts: [
          {
            Type: 'volume',
            Source: volumeName,
            Target: '/data',
          },
        ],
        PortBindings: {
          [`${CONTAINER_INTERNAL_ANKI_PORT}/tcp`]: [
            { HostIp: HOST_LOOPBACK, HostPort: ankiPort.toString() },
          ],
          [`${CONTAINER_INTERNAL_NOVNC_PORT}/tcp`]: [
            { HostIp: HOST_LOOPBACK, HostPort: novncPort.toString() },
          ],
        },
      },
    };
    console.info(
      '[ankify-provision] docker.createContainer args:',
      JSON.stringify({ ...createOpts, Env: ['ANKICONNECT_API_KEY=<redacted>'] })
    );
    let container: DockerContainerLike;
    try {
      container = await this.docker.createContainer(createOpts);
      console.info(
        '[ankify-provision] docker.createContainer ok id=%s',
        container.id
      );
    } catch (error) {
      console.error('[ankify-provision] docker.createContainer threw:', error);
      throw error;
    }
    try {
      await container.start();
      console.info('[ankify-provision] container.start ok');
    } catch (error) {
      console.error('[ankify-provision] container.start threw:', error);
      throw error;
    }
    return container;
  }
}

export const ankifyVolumeNameForOwner = (owner: number): string =>
  `ankify-rac-owner-${owner}-data`;

export const hashToken = (plaintext: string): string =>
  crypto.createHash('sha256').update(plaintext).digest('hex');

const generateTokenPlaintext = (): string =>
  crypto.randomBytes(SESSION_TOKEN_BYTES).toString('base64url');

const generateAnkiConnectApiKey = (): string =>
  crypto.randomBytes(ANKICONNECT_API_KEY_BYTES).toString('base64url');

const buildSessionUrl = (plaintext: string, novncPort: number): string => {
  const base = process.env.ANKIFY_SESSION_URL_BASE;
  if (base != null && base.length > 0) {
    const trimmed = base.replace(/\/$/, '');
    return `${trimmed}/v/${plaintext}/vnc.html`;
  }
  return `http://localhost:${novncPort}/vnc.html?token=${plaintext}`;
};

const pickPort = (range: PortRange, used: Set<number>): number => {
  for (let port = range.start; port <= range.end; port++) {
    if (!used.has(port)) {
      used.add(port);
      return port;
    }
  }
  throw new NoAvailablePortError();
};

const stripLeadingSlash = (value: string | undefined): string | null => {
  if (value == null) {
    return null;
  }
  return value.startsWith('/') ? value.slice(1) : value;
};
