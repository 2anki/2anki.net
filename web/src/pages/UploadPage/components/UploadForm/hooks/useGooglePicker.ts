import { useCallback, useRef } from 'react';

import {
  assertGoogleApiKeyShape,
  describeGoogleApiKeyProblem,
} from '../../../../../lib/google/assertGoogleApiKeyShape';

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  iconUrl: string;
  url: string;
  sizeBytes: number;
  embedUrl: string;
  description: string;
  driveSuccess: boolean;
  isShared: boolean;
  lastEditedUtc: number;
  rotation: number;
  rotationDegree: number;
  serviceId: string;
  type: string;
}

export type GooglePickerResult =
  | { kind: 'picked'; files: GoogleDriveFile[]; accessToken: string }
  | { kind: 'cancelled' };

interface PickerDoc {
  id: string;
  name: string;
  mimeType: string;
  iconUrl: string;
  url: string;
  sizeBytes?: number | string;
  embedUrl?: string;
  description?: string;
  isShared?: boolean;
  lastEditedUtc?: number;
  serviceId?: string;
  type?: string;
}

interface PickerCallbackData {
  action: 'picked' | 'cancel' | 'loaded';
  docs?: PickerDoc[];
}

interface PickerBuilder {
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setCallback: (cb: (data: PickerCallbackData) => void) => PickerBuilder;
  addView: (view: unknown) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
}

interface PickerGlobal {
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: unknown };
  Action: { PICKED: 'picked'; CANCEL: 'cancel'; LOADED: 'loaded' };
  DocsView: new () => {
    setIncludeFolders: (b: boolean) => unknown;
    setMimeTypes: (mimes: string) => unknown;
  };
}

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  callback: (resp: TokenResponse) => void;
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

interface GoogleAccountsOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
  }) => TokenClient;
}

declare global {
  interface Window {
    gapi?: {
      load: (lib: string, cb: () => void) => void;
    };
    google?: {
      picker?: PickerGlobal;
      accounts?: { oauth2: GoogleAccountsOAuth2 };
    };
  }
}

const GAPI_SRC = 'https://apis.google.com/js/api.js';
const GAPI_SCRIPT_ID = 'gapi-js';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GIS_SCRIPT_ID = 'gis-js';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const GOOGLE_UNAVAILABLE =
  "Couldn't load Google Drive. Check your connection or disable script blockers and try again.";
const AUTH_TIMEOUT_MS = 60_000;
const AUTH_TIMEOUT_MESSAGE =
  "Google Drive sign-in didn't complete. If your browser blocked the pop-up, allow pop-ups for 2anki.net and try again.";

function clientId(): string | null {
  const id = process.env.REACT_APP_GOOGLE_CLIENT_ID;
  return id && id.length > 0 ? id : null;
}

let warnedApiKeyShape = false;

function apiKey(): string | null {
  const shape = assertGoogleApiKeyShape(process.env.REACT_APP_GOOGLE_API_KEY);
  if (shape.valid) {
    return shape.key;
  }
  if (shape.reason !== 'empty' && !warnedApiKeyShape) {
    warnedApiKeyShape = true;
    // eslint-disable-next-line no-console
    console.error(describeGoogleApiKeyProblem(shape));
  }
  return null;
}

function loadScript(src: string, id: string): Promise<void> {
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing) {
    if (existing.dataset.loaded === 'true') return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error(GOOGLE_UNAVAILABLE))
      );
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    });
    script.addEventListener('error', () =>
      reject(new Error(GOOGLE_UNAVAILABLE))
    );
    document.head.appendChild(script);
  });
}

function loadPicker(): Promise<PickerGlobal> {
  const existing = window.google?.picker;
  if (existing) return Promise.resolve(existing);
  const ensureGapi: Promise<void> = window.gapi
    ? Promise.resolve()
    : loadScript(GAPI_SRC, GAPI_SCRIPT_ID);
  return ensureGapi.then(
    () =>
      new Promise<PickerGlobal>((resolve, reject) => {
        if (!window.gapi) {
          reject(new Error(GOOGLE_UNAVAILABLE));
          return;
        }
        window.gapi.load('picker', () => {
          const picker = window.google?.picker;
          if (picker) resolve(picker);
          else reject(new Error(GOOGLE_UNAVAILABLE));
        });
      })
  );
}

function loadIdentityServices(): Promise<GoogleAccountsOAuth2> {
  const existing = window.google?.accounts?.oauth2;
  if (existing) return Promise.resolve(existing);
  return loadScript(GIS_SRC, GIS_SCRIPT_ID).then(() => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) throw new Error(GOOGLE_UNAVAILABLE);
    return oauth2;
  });
}

function toGoogleDriveFile(doc: PickerDoc): GoogleDriveFile {
  return {
    id: doc.id,
    name: doc.name,
    mimeType: doc.mimeType,
    iconUrl: doc.iconUrl,
    url: doc.url,
    sizeBytes:
      typeof doc.sizeBytes === 'string'
        ? Number.parseInt(doc.sizeBytes, 10) || 0
        : (doc.sizeBytes ?? 0),
    embedUrl: doc.embedUrl ?? '',
    description: doc.description ?? '',
    driveSuccess: true,
    isShared: doc.isShared ?? false,
    lastEditedUtc: doc.lastEditedUtc ?? 0,
    rotation: 0,
    rotationDegree: 0,
    serviceId: doc.serviceId ?? '',
    type: doc.type ?? 'document',
  };
}

export function useGooglePicker() {
  const inFlightRef = useRef(false);

  const openPicker = useCallback((): Promise<GooglePickerResult> => {
    const id = clientId();
    const key = apiKey();
    if (id == null || key == null) {
      return Promise.reject(new Error(GOOGLE_UNAVAILABLE));
    }
    if (inFlightRef.current) {
      return Promise.reject(new Error('Google Drive picker is already open.'));
    }
    inFlightRef.current = true;

    const projectNumber = id.split('-')[0];

    return Promise.all([loadPicker(), loadIdentityServices()])
      .then(
        ([picker, oauth2]) =>
          new Promise<GooglePickerResult>((resolve, reject) => {
            // GIS's callback never fires if the browser blocks the sign-in
            // pop-up outright, and unreliably fires if the user closes it
            // manually — either way the promise (and the in-flight guard)
            // would hang forever without this. Only the auth phase races
            // the timeout; once a response arrives, the picker's own file
            // browser can stay open as long as the user needs.
            const authTimeout = setTimeout(() => {
              reject(new Error(AUTH_TIMEOUT_MESSAGE));
            }, AUTH_TIMEOUT_MS);

            const tokenClient = oauth2.initTokenClient({
              client_id: id,
              scope: SCOPE,
              callback: (resp) => {
                clearTimeout(authTimeout);
                if (resp.error || !resp.access_token) {
                  reject(
                    new Error(
                      resp.error_description ?? resp.error ?? GOOGLE_UNAVAILABLE
                    )
                  );
                  return;
                }
                const view = new picker.DocsView();
                view.setIncludeFolders(false);
                const built = new picker.PickerBuilder()
                  .setAppId(projectNumber)
                  .setOAuthToken(resp.access_token)
                  .setDeveloperKey(key)
                  .addView(view)
                  .setCallback((data) => {
                    if (data.action === picker.Action.PICKED) {
                      const files = (data.docs ?? []).map(toGoogleDriveFile);
                      resolve({
                        kind: 'picked',
                        files,
                        accessToken: resp.access_token!,
                      });
                    } else if (data.action === picker.Action.CANCEL) {
                      resolve({ kind: 'cancelled' });
                    }
                  })
                  .build();
                built.setVisible(true);
              },
            });
            tokenClient.requestAccessToken({ prompt: '' });
          })
      )
      .finally(() => {
        inFlightRef.current = false;
      });
  }, []);

  return { openPicker, isConfigured: clientId() != null && apiKey() != null };
}
