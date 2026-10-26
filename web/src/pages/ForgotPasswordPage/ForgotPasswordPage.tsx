import ForgotPasswordForm from '../../components/forms/ForgotPasswordForm/ForgotPasswordForm';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';
import { NoIndex } from '../../components/NoIndex/NoIndex';

interface Props {
  setErrorMessage: ErrorHandlerType;
}

export function ForgotPasswordPage({ setErrorMessage }: Readonly<Props>) {
  return (
    <>
      <NoIndex />
      <ForgotPasswordForm setError={setErrorMessage} />
    </>
  );
}
