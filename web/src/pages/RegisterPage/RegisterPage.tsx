import RegisterForm from '../../components/forms/RegisterForm';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';
import { useSearchParams } from 'react-router-dom';
import { AuthPageBackground } from '../../components/AuthPageBackground';
import { NoIndex } from '../../components/NoIndex/NoIndex';

interface Props {
  setErrorMessage: ErrorHandlerType;
}

export function RegisterPage({ setErrorMessage }: Readonly<Props>) {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');

  return (
    <AuthPageBackground>
      <NoIndex />
      <RegisterForm setErrorMessage={setErrorMessage} redirect={redirect} />
    </AuthPageBackground>
  );
}
