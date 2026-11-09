// The deck writer's operator email names the request or job it failed on
// instead of anything from the user's files; it reads the reference here.
export function deckWriterEnv(
  reference: string | undefined
): NodeJS.ProcessEnv | undefined {
  if (reference == null || reference === '') return undefined;
  return { ...process.env, TWOANKI_REQUEST_ID: reference };
}
