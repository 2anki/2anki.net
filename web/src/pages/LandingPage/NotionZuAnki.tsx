import LandingPage from './LandingPage';
import notionZuAnkiCopy from './copy/notion-zu-anki';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';

interface Props {
  setErrorMessage: ErrorHandlerType;
}

export default function NotionZuAnki({ setErrorMessage }: Readonly<Props>) {
  return (
    <LandingPage copy={notionZuAnkiCopy} setErrorMessage={setErrorMessage} />
  );
}
