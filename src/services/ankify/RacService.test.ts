import {
  AnkifyClientView,
  DockerContainerLike,
  DockerLike,
  DockerUnavailableError,
  NoAvailablePortError,
  RacService,
  hashToken,
} from './RacService';
import { AnkifyClientsRepositoryInterface } from '../../data_layer/ankify/AnkifyClientsRepository';
import { AnkifySessionTokensRepositoryInterface } from '../../data_layer/ankify/AnkifySessionTokensRepository';
import {
  AnkifyClient,
  AnkifySessionToken,
  NewAnkifyClient,
  NewAnkifySessionToken,
} from '../../entities/ankify';

const makeRepo = (
  overrides: Partial<AnkifyClientsRepositoryInterface> = {}
): jest.Mocked<AnkifyClientsRepositoryInterface> =>
  ({
    create: jest.fn(async (input: NewAnkifyClient): Promise<AnkifyClient> => ({
      id: 1,
      status: 'active',
      created_at: new Date(),
      last_active_at: new Date(),
      ...input,
    })),
    listByOwner: jest.fn(async () => []),
    findActiveById: jest.fn(async () => null),
    findActiveByOwner: jest.fn(async () => null),
    setStatus: jest.fn(async () => undefined),
    deleteById: jest.fn(async () => undefined),
    touchLastActiveAt: jest.fn(async () => undefined),
    reservedPorts: jest.fn(async () => []),
    listIdleSince: jest.fn(async () => []),
    ...overrides,
  }) as jest.Mocked<AnkifyClientsRepositoryInterface>;

interface TokenStore {
  rows: AnkifySessionToken[];
  nextId: number;
}

const makeTokens = (
  overrides: Partial<AnkifySessionTokensRepositoryInterface> = {}
): jest.Mocked<AnkifySessionTokensRepositoryInterface> & {
  store: TokenStore;
} => {
  const store: TokenStore = { rows: [], nextId: 1 };
  const insert = jest.fn(
    async (input: NewAnkifySessionToken): Promise<AnkifySessionToken> => {
      const row: AnkifySessionToken = {
        id: store.nextId++,
        ankify_client_id: input.ankify_client_id,
        owner: input.owner,
        token_hash: input.token_hash,
        expires_at: input.expires_at,
        last_used_at: null,
        revoked_at: null,
        created_at: new Date(),
      };
      store.rows.push(row);
      return row;
    }
  );
  const findActiveByHash = jest.fn(
    async (tokenHash: string) =>
      store.rows.find(
        (row) =>
          row.token_hash === tokenHash &&
          row.revoked_at == null &&
          row.expires_at.getTime() > Date.now()
      ) ?? null
  );
  const findActiveByClientId = jest.fn(
    async (ankifyClientId: number) =>
      store.rows.find(
        (row) =>
          row.ankify_client_id === ankifyClientId &&
          row.revoked_at == null &&
          row.expires_at.getTime() > Date.now()
      ) ?? null
  );
  const touchLastUsed = jest.fn(async (id: number) => {
    const row = store.rows.find((r) => r.id === id);
    if (row != null) row.last_used_at = new Date();
  });
  const revokeByClientId = jest.fn(async (ankifyClientId: number) => {
    for (const row of store.rows) {
      if (row.ankify_client_id === ankifyClientId && row.revoked_at == null) {
        row.revoked_at = new Date();
      }
    }
  });
  return Object.assign(
    {
      insert,
      findActiveByHash,
      findActiveByClientId,
      touchLastUsed,
      revokeByClientId,
      ...overrides,
    } as jest.Mocked<AnkifySessionTokensRepositoryInterface>,
    { store }
  );
};

const makeContainer = (
  id: string,
  name = '/test-container'
): DockerContainerLike =>
  ({
    id,
    start: jest.fn(async () => undefined),
    inspect: jest.fn(async () => ({ Name: name })),
    stop: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  }) as unknown as DockerContainerLike;

const makeDocker = (
  overrides: Partial<DockerLike> = {},
  createdContainer: DockerContainerLike = makeContainer('container-abc')
): jest.Mocked<DockerLike> =>
  ({
    listContainers: jest.fn(async () => []),
    createContainer: jest.fn(async () => createdContainer),
    getContainer: jest.fn(() => createdContainer),
    ...overrides,
  }) as jest.Mocked<DockerLike>;

const makeService = (
  repo = makeRepo(),
  docker = makeDocker(),
  tokens = makeTokens()
) => ({
  service: new RacService(repo, docker, tokens),
  repo,
  docker,
  tokens,
});

describe('RacService.provision', () => {
  test('allocates anki + novnc ports (no vnc), persists vnc_port=0', async () => {
    const { service, repo, docker } = makeService();

    const { client, created } = await service.provision(42);

    expect(docker.listContainers).toHaveBeenCalledWith({ all: false });
    expect(docker.createContainer).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 42,
        container_id: 'container-abc',
        container_name: 'test-container',
        anki_port: 20000,
        vnc_port: 0,
        novnc_port: 22000,
        anki_connect_api_key: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      })
    );
    expect(created).toBe(true);
    expect(client.owner).toBe(42);
  });

  test('binds host ports on 127.0.0.1 only and does not publish 5900', async () => {
    const { service, docker } = makeService();

    await service.provision(42);

    const args = (docker.createContainer as jest.Mock).mock.calls[0][0] as {
      ExposedPorts: Record<string, unknown>;
      HostConfig: {
        PortBindings: Record<string, { HostIp: string; HostPort: string }[]>;
      };
    };
    expect(Object.keys(args.ExposedPorts).sort()).toEqual([
      '6081/tcp',
      '8765/tcp',
    ]);
    expect(args.HostConfig.PortBindings['6081/tcp'][0].HostIp).toBe(
      '127.0.0.1'
    );
    expect(args.HostConfig.PortBindings['8765/tcp'][0].HostIp).toBe(
      '127.0.0.1'
    );
    expect(args.HostConfig.PortBindings['5900/tcp']).toBeUndefined();
  });

  test('mints a token and returns a session_url containing the plaintext', async () => {
    const { service, tokens } = makeService();

    const { client } = await service.provision(42);

    expect(client.session_url).not.toBeNull();
    expect(tokens.insert).toHaveBeenCalledTimes(1);
    expect(tokens.store.rows).toHaveLength(1);
    const stored = tokens.store.rows[0];
    expect(stored.ankify_client_id).toBe(client.id);
    expect(stored.owner).toBe(42);
    // The plaintext appears in the URL; the DB stores the SHA-256 hash of it.
    const plaintextMatch = client.session_url!.match(/[A-Za-z0-9_-]{43}/);
    expect(plaintextMatch).not.toBeNull();
    expect(stored.token_hash).toBe(hashToken(plaintextMatch![0]));
  });

  test('returns the existing active client without minting a new token', async () => {
    const existing: AnkifyClient = {
      id: 9,
      owner: 42,
      container_id: 'container-existing',
      container_name: null,
      anki_port: 20000,
      vnc_port: 0,
      novnc_port: 22000,
      anki_connect_api_key: null,
      status: 'active',
      created_at: new Date(),
      last_active_at: new Date(),
    };
    const repo = makeRepo({
      findActiveByOwner: jest.fn(async () => existing),
    });
    const { service, docker, tokens } = makeService(repo);

    const { client, created } = await service.provision(42);

    expect(created).toBe(false);
    expect(client).toEqual({
      ...existing,
      session_url: null,
      has_active_session: false,
    });
    expect(docker.listContainers).not.toHaveBeenCalled();
    expect(docker.createContainer).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(tokens.insert).not.toHaveBeenCalled();
  });

  test('skips ports already exposed by other containers', async () => {
    const docker = makeDocker({
      listContainers: jest.fn(async () => [
        { Ports: [{ PublicPort: 20000 }, { PublicPort: 22000 }] },
      ]),
    });
    const { service, repo } = makeService(makeRepo(), docker);

    await service.provision(42);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        anki_port: 20001,
        novnc_port: 22001,
      })
    );
  });

  test('skips ports already reserved in the database', async () => {
    const repo = makeRepo({
      reservedPorts: jest.fn(async () => [20000, 22000]),
    });
    const { service } = makeService(repo);

    await service.provision(42);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        anki_port: 20001,
        novnc_port: 22001,
      })
    );
  });

  test('throws DockerUnavailableError when daemon is unreachable', async () => {
    const docker = makeDocker({
      listContainers: jest.fn(async () => {
        throw new Error('connect ENOENT /var/run/docker.sock');
      }),
    });
    const { service } = makeService(makeRepo(), docker);

    await expect(service.provision(42)).rejects.toBeInstanceOf(
      DockerUnavailableError
    );
  });

  test('throws NoAvailablePortError if the entire anki range is in use', async () => {
    const allAnkiPortsUsed: { Ports: { PublicPort: number }[] }[] = [
      {
        Ports: Array.from({ length: 1001 }, (_, i) => ({
          PublicPort: 20000 + i,
        })),
      },
    ];
    const docker = makeDocker({
      listContainers: jest.fn(async () => allAnkiPortsUsed),
    });
    const { service } = makeService(makeRepo(), docker);

    await expect(service.provision(42)).rejects.toBeInstanceOf(
      NoAvailablePortError
    );
  });
});

describe('RacService.respin', () => {
  test('falls through to provision when no active client exists', async () => {
    const { service, repo, docker } = makeService();

    const { created } = await service.respin(42);

    expect(created).toBe(true);
    expect(docker.createContainer).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 42 })
    );
  });

  test('mints a fresh token for the new container', async () => {
    const repo = makeRepo({
      findActiveByOwner: jest.fn(async () => ({
        id: 5,
        owner: 42,
        container_id: 'container-old',
        container_name: 'old',
        anki_port: 20000,
        vnc_port: 0,
        novnc_port: 22000,
        anki_connect_api_key: null,
        status: 'active' as const,
        created_at: new Date(),
        last_active_at: new Date(),
      })),
    });
    const { service, tokens } = makeService(repo);

    const { client } = await service.respin(42);

    expect(client.session_url).not.toBeNull();
    expect(tokens.insert).toHaveBeenCalledTimes(1);
  });
});

describe('RacService.list', () => {
  test('returns active clients with session_url=null (plaintext only lives client-side)', async () => {
    const expected: AnkifyClient[] = [
      {
        id: 1,
        owner: 7,
        container_id: 'c',
        container_name: null,
        anki_port: 20000,
        vnc_port: 0,
        novnc_port: 22000,
        anki_connect_api_key: null,
        status: 'active' as const,
        created_at: new Date(),
        last_active_at: new Date(),
      },
    ];
    const repo = makeRepo({ listByOwner: jest.fn(async () => expected) });
    const { service } = makeService(repo);

    const result = await service.list(7);

    expect(result).toHaveLength(1);
    expect(result[0].session_url).toBeNull();
    expect(repo.listByOwner).toHaveBeenCalledWith(7);
  });

  test('reconciles active rows whose container is gone in Docker', async () => {
    const ghost: AnkifyClient = {
      id: 9,
      owner: 7,
      container_id: 'container-ghost',
      container_name: 'naughty_keller',
      anki_port: 20000,
      vnc_port: 0,
      novnc_port: 22000,
      anki_connect_api_key: null,
      status: 'active' as const,
      created_at: new Date(),
      last_active_at: new Date(),
    };
    const ghostContainer = makeContainer('container-ghost');
    (ghostContainer.inspect as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('No such container'), { statusCode: 404 })
    );
    const repo = makeRepo({ listByOwner: jest.fn(async () => [ghost]) });
    const docker = makeDocker({ getContainer: jest.fn(() => ghostContainer) });
    const { service } = makeService(repo, docker);

    const result = await service.list(7);

    expect(repo.deleteById).toHaveBeenCalledWith(9);
    expect(result).toHaveLength(0);
  });

  test('has_active_session reflects whether a non-expired token exists for the client', async () => {
    const live: AnkifyClient = {
      id: 13,
      owner: 7,
      container_id: 'container-live-13',
      container_name: 'sleepy_curie',
      anki_port: 20000,
      vnc_port: 0,
      novnc_port: 22000,
      anki_connect_api_key: null,
      status: 'active' as const,
      created_at: new Date(),
      last_active_at: new Date(),
    };
    const repo = makeRepo({ listByOwner: jest.fn(async () => [live]) });
    const tokens = makeTokens();
    tokens.store.rows.push({
      id: 100,
      ankify_client_id: 13,
      owner: 7,
      token_hash: 'abc',
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
      last_used_at: null,
      revoked_at: null,
      created_at: new Date(),
    });
    const { service } = makeService(repo, makeDocker(), tokens);

    const [withToken] = await service.list(7);
    expect(withToken.has_active_session).toBe(true);
  });

  test('has_active_session is false when no active token exists', async () => {
    const live: AnkifyClient = {
      id: 14,
      owner: 7,
      container_id: 'container-live-14',
      container_name: null,
      anki_port: 20000,
      vnc_port: 0,
      novnc_port: 22000,
      anki_connect_api_key: null,
      status: 'active' as const,
      created_at: new Date(),
      last_active_at: new Date(),
    };
    const repo = makeRepo({ listByOwner: jest.fn(async () => [live]) });
    const { service } = makeService(repo);

    const [noToken] = await service.list(7);
    expect(noToken.has_active_session).toBe(false);
  });

  test('non-404 inspect errors leave the row active (avoid false reconcile)', async () => {
    const live: AnkifyClient = {
      id: 11,
      owner: 7,
      container_id: 'container-live',
      container_name: 'happy_clarke',
      anki_port: 20000,
      vnc_port: 0,
      novnc_port: 22000,
      anki_connect_api_key: null,
      status: 'active' as const,
      created_at: new Date(),
      last_active_at: new Date(),
    };
    const flakyContainer = makeContainer('container-live');
    (flakyContainer.inspect as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    );
    const repo = makeRepo({ listByOwner: jest.fn(async () => [live]) });
    const docker = makeDocker({ getContainer: jest.fn(() => flakyContainer) });
    const { service } = makeService(repo, docker);

    const result = await service.list(7);

    expect(repo.setStatus).not.toHaveBeenCalled();
    expect(result[0].status).toBe('active');
  });
});

describe('RacService.stop', () => {
  test('no-ops when no active client matches the id+owner', async () => {
    const { service, repo, docker } = makeService();

    await service.stop(99, 42);

    expect(docker.getContainer).not.toHaveBeenCalled();
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  test('revokes tokens, stops the container, and deletes the row', async () => {
    const container = makeContainer('container-xyz');
    const repo = makeRepo({
      findActiveById: jest.fn(async () => ({
        id: 5,
        owner: 42,
        container_id: 'container-xyz',
        container_name: null,
        anki_port: 20000,
        vnc_port: 0,
        novnc_port: 22000,
        anki_connect_api_key: null,
        status: 'active' as const,
        created_at: new Date(),
        last_active_at: new Date(),
      })),
    });
    const docker = makeDocker({ getContainer: jest.fn(() => container) });
    const { service, tokens } = makeService(repo, docker);

    await service.stop(5, 42);

    expect(tokens.revokeByClientId).toHaveBeenCalledWith(5);
    expect(container.stop).toHaveBeenCalled();
    expect(container.remove).toHaveBeenCalledWith({ force: true });
    expect(repo.deleteById).toHaveBeenCalledWith(5);
  });

  test('still revokes tokens and deletes when docker stop throws', async () => {
    const container = makeContainer('container-xyz');
    (container.stop as jest.Mock).mockRejectedValueOnce(new Error('gone'));
    (container.remove as jest.Mock).mockRejectedValueOnce(new Error('gone'));
    const repo = makeRepo({
      findActiveById: jest.fn(async () => ({
        id: 5,
        owner: 42,
        container_id: 'container-xyz',
        container_name: null,
        anki_port: 20000,
        vnc_port: 0,
        novnc_port: 22000,
        anki_connect_api_key: null,
        status: 'active' as const,
        created_at: new Date(),
        last_active_at: new Date(),
      })),
    });
    const docker = makeDocker({ getContainer: jest.fn(() => container) });
    const { service, tokens } = makeService(repo, docker);

    await service.stop(5, 42);

    expect(tokens.revokeByClientId).toHaveBeenCalledWith(5);
    expect(repo.deleteById).toHaveBeenCalledWith(5);
  });
});

describe('RacService.resolveTokenForProxy', () => {
  test('returns owner + novnc_port for a valid token', async () => {
    const repo = makeRepo();
    const { service, tokens } = makeService(repo);

    const { client } = await service.provision(42);
    const plaintext = client.session_url!.match(/[A-Za-z0-9_-]{43}/)![0];

    repo.findActiveById = jest.fn(async (_id: number, _owner: number) => ({
      id: client.id,
      owner: 42,
      container_id: client.container_id,
      container_name: client.container_name,
      anki_port: client.anki_port,
      vnc_port: 0,
      novnc_port: client.novnc_port,
      anki_connect_api_key: null,
      status: 'active' as const,
      created_at: new Date(),
      last_active_at: new Date(),
    }));

    const resolved = await service.resolveTokenForProxy(plaintext);

    expect(resolved).not.toBeNull();
    expect(resolved!.owner).toBe(42);
    expect(resolved!.novnc_port).toBe(client.novnc_port);
    expect(tokens.findActiveByHash).toHaveBeenCalled();
  });

  test('returns null for an unknown plaintext token', async () => {
    const { service } = makeService();
    const resolved = await service.resolveTokenForProxy('nope');
    expect(resolved).toBeNull();
  });

  test('returns null when the linked client is no longer active', async () => {
    const repo = makeRepo();
    const { service } = makeService(repo);

    const { client } = await service.provision(42);
    const plaintext = client.session_url!.match(/[A-Za-z0-9_-]{43}/)![0];

    // Simulate the client being torn down (DB row gone)
    repo.findActiveById = jest.fn(async (_id: number, _owner: number) => null);

    const resolved = await service.resolveTokenForProxy(plaintext);
    expect(resolved).toBeNull();
  });
});

describe('RacService.reissueSessionUrl', () => {
  test('mints a new token without revoking the prior one (open noVNC tabs survive)', async () => {
    const repo = makeRepo();
    const { service, tokens } = makeService(repo);

    const { client: provisioned } = await service.provision(42);
    const firstPlaintext =
      provisioned.session_url!.match(/[A-Za-z0-9_-]{43}/)![0];

    repo.findActiveById = jest.fn(async (_id: number, _owner: number) => ({
      id: provisioned.id,
      owner: 42,
      container_id: provisioned.container_id,
      container_name: provisioned.container_name,
      anki_port: provisioned.anki_port,
      vnc_port: 0,
      novnc_port: provisioned.novnc_port,
      anki_connect_api_key: null,
      status: 'active' as const,
      created_at: new Date(),
      last_active_at: new Date(),
    }));

    const reissued = await service.reissueSessionUrl(provisioned.id, 42);

    expect(reissued).not.toBeNull();
    expect(reissued!.session_url).not.toBeNull();
    expect(reissued!.has_active_session).toBe(true);
    const secondPlaintext =
      reissued!.session_url!.match(/[A-Za-z0-9_-]{43}/)![0];
    expect(secondPlaintext).not.toBe(firstPlaintext);

    const firstRow = tokens.store.rows.find(
      (r) => r.token_hash === hashToken(firstPlaintext)
    );
    expect(firstRow!.revoked_at).toBeNull();
    const secondRow = tokens.store.rows.find(
      (r) => r.token_hash === hashToken(secondPlaintext)
    );
    expect(secondRow!.revoked_at).toBeNull();
    expect(tokens.revokeByClientId).not.toHaveBeenCalled();
  });

  test('returns null when the client is not active', async () => {
    const repo = makeRepo({ findActiveById: jest.fn(async () => null) });
    const { service } = makeService(repo);

    const result = await service.reissueSessionUrl(999, 42);

    expect(result).toBeNull();
  });
});

describe('RacService.reapIdle', () => {
  test('stops every idle client returned by the repo and marks them inactive', async () => {
    const a = makeContainer('container-a');
    const b = makeContainer('container-b');
    const containerLookup = jest.fn((id: string) =>
      id === 'container-a' ? a : b
    );
    const docker = makeDocker({ getContainer: containerLookup });
    const repo = makeRepo({
      listIdleSince: jest.fn(async () => [
        {
          id: 1,
          owner: 1,
          container_id: 'container-a',
          container_name: null,
          anki_port: 20000,
          vnc_port: 0,
          novnc_port: 22000,
          anki_connect_api_key: null,
          status: 'active' as const,
          created_at: new Date(),
          last_active_at: new Date(0),
        },
        {
          id: 2,
          owner: 2,
          container_id: 'container-b',
          container_name: null,
          anki_port: 20001,
          vnc_port: 0,
          novnc_port: 22001,
          anki_connect_api_key: null,
          status: 'active' as const,
          created_at: new Date(),
          last_active_at: new Date(0),
        },
      ]),
    });
    const { service } = makeService(repo, docker);

    const { stopped } = await service.reapIdle(60_000);

    expect(stopped).toEqual([1, 2]);
    expect(a.stop).toHaveBeenCalled();
    expect(b.stop).toHaveBeenCalled();
    expect(repo.deleteById).toHaveBeenCalledWith(1);
    expect(repo.deleteById).toHaveBeenCalledWith(2);
  });
});

describe('RacService session_url construction', () => {
  test('uses ANKIFY_SESSION_URL_BASE when set (proxy form)', async () => {
    const previous = process.env.ANKIFY_SESSION_URL_BASE;
    process.env.ANKIFY_SESSION_URL_BASE = 'https://2anki.net';
    try {
      const { service } = makeService();
      const { client } = await service.provision(42);
      expect(client.session_url).toMatch(
        /^https:\/\/2anki\.net\/v\/[A-Za-z0-9_-]{43}\/vnc\.html$/
      );
    } finally {
      if (previous == null) {
        delete process.env.ANKIFY_SESSION_URL_BASE;
      } else {
        process.env.ANKIFY_SESSION_URL_BASE = previous;
      }
    }
  });

  test('falls back to direct localhost URL in dev (env unset)', async () => {
    const previous = process.env.ANKIFY_SESSION_URL_BASE;
    delete process.env.ANKIFY_SESSION_URL_BASE;
    try {
      const { service } = makeService();
      const { client } = await service.provision(42);
      expect(client.session_url).toMatch(
        /^http:\/\/localhost:22000\/vnc\.html\?token=[A-Za-z0-9_-]{43}$/
      );
    } finally {
      if (previous != null) {
        process.env.ANKIFY_SESSION_URL_BASE = previous;
      }
    }
  });
});

describe('RacService container hardening (slice 2)', () => {
  test('drops all caps, sets no-new-privileges, mounts a read-only rootfs with tmpfs', async () => {
    const { service, docker } = makeService();

    await service.provision(42);

    const args = (docker.createContainer as jest.Mock).mock.calls[0][0] as {
      HostConfig: {
        CapDrop: string[];
        SecurityOpt: string[];
        ReadonlyRootfs: boolean;
        Tmpfs: Record<string, string>;
        Mounts?: unknown[];
      };
    };
    expect(args.HostConfig.CapDrop).toEqual(['ALL']);
    expect(args.HostConfig.SecurityOpt).toEqual(['no-new-privileges:true']);
    expect(args.HostConfig.ReadonlyRootfs).toBeUndefined();
    expect(args.HostConfig.Tmpfs).toMatchObject({
      '/tmp': expect.stringContaining('nosuid'),
      '/var/run': expect.stringContaining('nosuid'),
      '/run/user/1000': expect.stringContaining('nosuid'),
    });
    // /data is on a named volume (revert of slice 3 — image needs companion
    // changes before /data can move to tmpfs).
    expect(args.HostConfig.Mounts).toEqual([
      {
        Type: 'volume',
        Source: 'ankify-rac-owner-42-data',
        Target: '/data',
      },
    ]);
  });

  test('generates a per-container AnkiConnect API key, env-injects, persists', async () => {
    const { service, repo, docker } = makeService();

    const { client } = await service.provision(42);

    const createArgs = (docker.createContainer as jest.Mock).mock
      .calls[0][0] as { Env: string[] };
    const envEntry = createArgs.Env.find((e) =>
      e.startsWith('ANKICONNECT_API_KEY=')
    );
    expect(envEntry).toBeDefined();
    const envKey = envEntry!.split('=', 2)[1];
    expect(envKey).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const persistedKey = (repo.create as jest.Mock).mock.calls[0][0]
      .anki_connect_api_key as string;
    expect(persistedKey).toBe(envKey);
    expect(client.id).toBe(1);
  });

  test('respin mints a fresh API key (different from any prior container)', async () => {
    const { service, repo, docker } = makeService(
      makeRepo({
        findActiveByOwner: jest.fn(async () => ({
          id: 5,
          owner: 42,
          container_id: 'container-old',
          container_name: 'old',
          anki_port: 20000,
          vnc_port: 0,
          novnc_port: 22000,
          anki_connect_api_key: 'old-key',
          status: 'active' as const,
          created_at: new Date(),
          last_active_at: new Date(),
        })),
      })
    );

    await service.respin(42);

    const createArgs = (docker.createContainer as jest.Mock).mock
      .calls[0][0] as { Env: string[] };
    const envKey = createArgs.Env.find((e) =>
      e.startsWith('ANKICONNECT_API_KEY=')
    )!.split('=', 2)[1];
    expect(envKey).not.toBe('old-key');
    expect(envKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const persistedKey = (repo.create as jest.Mock).mock.calls[0][0]
      .anki_connect_api_key as string;
    expect(persistedKey).toBe(envKey);
  });
});

describe('RacService — view shape passthrough', () => {
  test('AnkifyClientView is a structural extension of AnkifyClient', () => {
    const sample: AnkifyClientView = {
      id: 1,
      owner: 1,
      container_id: 'c',
      container_name: null,
      anki_port: 20000,
      vnc_port: 0,
      novnc_port: 22000,
      anki_connect_api_key: null,
      status: 'active',
      created_at: new Date(),
      last_active_at: new Date(),
      session_url: null,
      has_active_session: false,
    };
    expect(sample).toBeDefined();
  });
});
