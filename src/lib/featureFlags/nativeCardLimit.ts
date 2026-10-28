// Kill switch for the native app's on-device monthly card limit
// (Laer-Smart/2anki.app#95). The app reads it from GET /api/native/config,
// signed in or not, so the cap can be turned off without an App Review cycle.
// Defaults on: the app ships with the cap, and a missing row must not drop it.
export const NATIVE_CARD_LIMIT_FLAG = 'native_card_limit';
export const NATIVE_CARD_LIMIT_DEFAULT = true;
