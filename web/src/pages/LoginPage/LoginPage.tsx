import { useEffect } from 'react';
import { useCookies } from 'react-cookie';
import LoginForm from './components/LoginForm';
import { AuthPageBackground } from '../../components/AuthPageBackground';
import { NoIndex } from '../../components/NoIndex/NoIndex';
import { useUserLocals } from '../../lib/hooks/useUserLocals';

export function LoginPage() {
  const [cookies, , removeCookie] = useCookies(['token']);
  const { isError } = useUserLocals();

  useEffect(() => {
    if (cookies.token && isError) {
      removeCookie('token', { path: '/' });
    }
  }, [cookies.token, isError, removeCookie]);

  return (
    <AuthPageBackground>
      <NoIndex />
      <LoginForm />
    </AuthPageBackground>
  );
}
