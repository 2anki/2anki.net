export interface OutboundErrorSummary {
  message: string;
  status: number | null;
  code: string | null;
  providerCode: string | null;
}

const MAX_MESSAGE_LENGTH = 200;
const MAX_PROVIDER_CODE_LENGTH = 100;

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const readProperty = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value != null
    ? (value as Record<string, unknown>)[key]
    : undefined;

const providerCodeFrom = (responseData: unknown): string | null => {
  const providerCode =
    stringOrNull(readProperty(responseData, 'code')) ??
    stringOrNull(readProperty(responseData, 'error'));
  return providerCode?.slice(0, MAX_PROVIDER_CODE_LENGTH) ?? null;
};

export const summarizeOutboundError = (
  error: unknown
): OutboundErrorSummary => {
  const message = error instanceof Error ? error.message : String(error);
  const response = readProperty(error, 'response');
  const status = readProperty(response, 'status');
  return {
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    status: typeof status === 'number' ? status : null,
    code: stringOrNull(readProperty(error, 'code')),
    providerCode: providerCodeFrom(readProperty(response, 'data')),
  };
};
