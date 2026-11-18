import { AnkiConnectClient, buildAnkiConnectUrl } from './AnkiConnectClient';

export const ankiConnectFactory = (
  host: string,
  port: number,
  apiKey: string | null
): AnkiConnectClient =>
  new AnkiConnectClient(
    buildAnkiConnectUrl(host, port),
    undefined,
    undefined,
    apiKey
  );

export const ankiConnectSendFactory = (
  host: string,
  port: number,
  apiKey: string | null
): AnkiConnectClient =>
  new AnkiConnectClient(
    buildAnkiConnectUrl(host, port),
    undefined,
    undefined,
    apiKey,
    'response'
  );
