import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

import StorageHandler from './StorageHandler';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://presigned-url'),
}));

describe('StorageHandler.getFileContents', () => {
  beforeEach(() => {
    mockSend.mockReset();
    process.env.SPACES_DEFAULT_BUCKET_NAME = 'test-bucket';
    process.env.SPACES_ENDPOINT = 'https://test.spaces.example.com';
  });

  it('drains the SDK v3 Body stream into a Buffer', async () => {
    const content = Buffer.from('hello from s3');
    mockSend.mockResolvedValueOnce({
      Body: {
        transformToByteArray: jest
          .fn()
          .mockResolvedValue(new Uint8Array(content)),
      },
    });

    const handler = new StorageHandler();
    const result = await handler.getFileContents('some/key.apkg');

    expect(result.Body).toBeInstanceOf(Buffer);
    expect(result.Body?.toString()).toBe('hello from s3');
  });

  it('returns undefined Body when the SDK response has no Body', async () => {
    mockSend.mockResolvedValueOnce({ Body: null });

    const handler = new StorageHandler();
    const result = await handler.getFileContents('some/key.apkg');

    expect(result.Body).toBeUndefined();
  });
});

describe('StorageHandler.getFileStream', () => {
  beforeEach(() => {
    mockSend.mockReset();
    process.env.SPACES_DEFAULT_BUCKET_NAME = 'test-bucket';
    process.env.SPACES_ENDPOINT = 'https://test.spaces.example.com';
  });

  it('hands back the SDK Body as a stream with its content length, without draining it', async () => {
    const body = Readable.from([Buffer.from('hello '), Buffer.from('from s3')]);
    mockSend.mockResolvedValueOnce({ Body: body, ContentLength: 13 });

    const handler = new StorageHandler();
    const result = await handler.getFileStream('some/key.apkg');

    expect(result?.body).toBe(body);
    expect(result?.contentLength).toBe(13);
    expect(body.readableEnded).toBe(false);
  });

  it('returns undefined when the SDK response has no Body', async () => {
    mockSend.mockResolvedValueOnce({ Body: null });

    const handler = new StorageHandler();
    const result = await handler.getFileStream('some/key.apkg');

    expect(result).toBeUndefined();
  });

  it('returns undefined when the Body is not a Node stream', async () => {
    mockSend.mockResolvedValueOnce({
      Body: { transformToByteArray: jest.fn() },
    });

    const handler = new StorageHandler();
    const result = await handler.getFileStream('some/key.apkg');

    expect(result).toBeUndefined();
  });
});

describe('StorageHandler.getPresignedUrl', () => {
  const signedUrlMock = getSignedUrl as jest.MockedFunction<
    typeof getSignedUrl
  >;

  beforeEach(() => {
    signedUrlMock.mockClear();
    process.env.SPACES_DEFAULT_BUCKET_NAME = 'test-bucket';
    process.env.SPACES_ENDPOINT = 'https://test.spaces.example.com';
  });

  function lastCall() {
    const { calls } = signedUrlMock.mock;
    return calls[calls.length - 1];
  }

  function lastCommandInput(): GetObjectCommand['input'] {
    const command = lastCall()[1] as GetObjectCommand;
    return command.input;
  }

  it('sets a download disposition and octet-stream type when a filename is given', async () => {
    const handler = new StorageHandler();
    await handler.getPresignedUrl(
      'owner-1-deck.apkg',
      300,
      'Biochemistry.apkg'
    );

    const input = lastCommandInput();
    expect(input.ResponseContentDisposition).toBe(
      'attachment; filename="Biochemistry.apkg"; ' +
        "filename*=UTF-8''Biochemistry.apkg"
    );
    expect(input.ResponseContentType).toBe('application/octet-stream');
    expect(lastCall()[2]).toEqual({ expiresIn: 300 });
  });

  it('omits the disposition and type headers when no filename is given', async () => {
    const handler = new StorageHandler();
    await handler.getPresignedUrl('owner-1-deck.apkg');

    const input = lastCommandInput();
    expect(input.ResponseContentDisposition).toBeUndefined();
    expect(input.ResponseContentType).toBeUndefined();
    expect(lastCall()[2]).toEqual({ expiresIn: 3600 });
  });
});
