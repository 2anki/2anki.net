import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';
import NewPassordForm from '../../components/forms/NewPasswordForm';
import { NoIndex } from '../../components/NoIndex/NoIndex';

interface Props {
  setErrorMessage: ErrorHandlerType;
}

export function NewPasswordPage({ setErrorMessage }: Readonly<Props>) {
  return (
    <>
      <NoIndex />
      <NewPassordForm setErrorMessage={setErrorMessage} />
    </>
  );
}
