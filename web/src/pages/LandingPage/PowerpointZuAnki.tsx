import LandingPage from './LandingPage';
import powerpointZuAnkiCopy from './copy/powerpoint-zu-anki';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';

interface Props {
  setErrorMessage: ErrorHandlerType;
}

export default function PowerpointZuAnki({ setErrorMessage }: Readonly<Props>) {
  return (
    <LandingPage
      copy={powerpointZuAnkiCopy}
      setErrorMessage={setErrorMessage}
    />
  );
}
