import LandingPage from './LandingPage';
import pdfZuAnkiCopy from './copy/pdf-zu-anki';
import { ErrorHandlerType } from '../../components/errors/helpers/getErrorMessage';

interface Props {
  setErrorMessage: ErrorHandlerType;
}

export default function PdfZuAnki({ setErrorMessage }: Readonly<Props>) {
  return <LandingPage copy={pdfZuAnkiCopy} setErrorMessage={setErrorMessage} />;
}
