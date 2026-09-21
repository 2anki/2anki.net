import React, {
  FormEventHandler,
  SetStateAction,
  SyntheticEvent,
  useState,
} from 'react';
import { useCookies } from 'react-cookie';
import {
  ErrorHandlerType,
  getErrorMessage,
} from '../../../../../components/errors/helpers/getErrorMessage';
import { get2ankiApi } from '../../../../../lib/backend/get2ankiApi';
import {
  migrateToServer,
  hydrateFromServer,
} from '../../../../../lib/data_layer/userPreferencesSync';

interface LoginState {
  email: string;
  password: string;
  loading: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  setEmail: React.Dispatch<SetStateAction<string>>;
  setPassword: React.Dispatch<SetStateAction<string>>;
}

const isSafeRedirect = (value: string): boolean =>
  value.startsWith('/') && !value.startsWith('//') && !value.includes(':');

const getUrlRedirect = (): string | undefined => {
  const params = new URLSearchParams(globalThis.location.search);
  const value = params.get('redirect');
  if (value == null) return undefined;
  return isSafeRedirect(value) ? value : undefined;
};

export const useHandleLoginSubmit = (onError: ErrorHandlerType): LoginState => {
  const [loading, setLoading] = useState(false);
  const [, setCookie] = useCookies(['token']);
  const [email, setEmail] = useState(localStorage.getItem('email') ?? '');
  const [password, setPassword] = useState('');

  const onSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setLoading(true);

    try {
      const res = await get2ankiApi().login(email, password);
      if (res.status === 200) {
        const { token, redirect } = await res.json();
        setCookie('token', token);
        await migrateToServer();
        await hydrateFromServer();
        globalThis.location.href = redirect ?? getUrlRedirect() ?? '/search';
      } else if (res.status === 401) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string;
          hint?: string;
        };
        const base =
          'Wrong email or password. Try again or reset your password.';
        const detail =
          data.hint === 'google'
            ? ' This account uses Google sign-in — use "Sign in with Google" or send a login link.'
            : '';
        onError(new Error(base + detail));
      } else {
        onError(
          new Error(
            'Wrong email or password. Try again or reset your password.'
          )
        );
      }
      setLoading(false);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      onError(errorMessage);
      setLoading(false);
    }
  };

  return {
    email,
    password,
    loading,
    onSubmit,
    setEmail,
    setPassword,
  };
};
