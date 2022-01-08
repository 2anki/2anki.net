import styled from "styled-components";
import { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import useQuery from "../lib/hooks/useQuery";
import StoreContext from "../store/StoreContext";
import WarningMessage from "../components/WarningMessage";
import UploadForm from "../components/UploadForm";
import SettingsIcon from "../components/icons/SettingsIcon";
import SettingsModal from "../components/modals/SettingsModal";
import ErrorMessage from "../components/ErrorMessage";
import Container from "../components/Container";
import SupportSection from "../components/SupportSection";

const InfoMessage = styled.p`
  font-size: 11px;
  margin: 0 auto;
  max-width: 480px;
  color: grey;
  padding-top: 1rem;
`;

const UploadPage = () => {
  const isDevelopment = window.location.host !== "2anki.net";
  const query = useQuery();
  const view = query.get("view");

  const [isSettings, setShowSettings] = useState(
    view === "template" || view === "deck-options" || view === "card-options"
  );
  const [errorMessage, setErrorMessage] = useState("");

  const FlexColumn = styled.div`
    display: flex;
    justify-content: space-between;
  `;

  const ImportTitle = styled.h2`
    font-size: 1.5rem;
    font-weight: bold;
  `;

  const SettingsLink = styled.div`
    display: flex;
    align-items: center;
    justify-items: center;
    .link {
      display: flex;
      color: grey;
    }
  `;

  const store = useContext(StoreContext);

  // Make sure the defaults are set if not present to ensure backwards compatability
  useEffect(() => {
    store.syncLocalStorage();
  }, [store]);

  return (
    <Container>
      {errorMessage && <ErrorMessage msg={errorMessage} />}
      {!errorMessage && (
        <>
          {isDevelopment ? <WarningMessage /> : null}
          <FlexColumn>
            <ImportTitle>Import</ImportTitle>
            <SettingsLink onClick={() => setShowSettings(true)}>
              <Link className="link" to="upload?view=template">
                <SettingsIcon />
                Settings
              </Link>
            </SettingsLink>
          </FlexColumn>
          <div className="container">
            <UploadForm
              errorMessage={errorMessage}
              setErrorMessage={setErrorMessage}
            />
            <InfoMessage>
              2anki.net currently only supports
              <a
                rel="noreferrer"
                target="_blank"
                href="https://www.notion.so/Export-as-HTML-bf3fe9e6920e4b9883cbd8a76b6128b7"
              >
                {" "}
                HTML and ZIP exports from Notion
              </a>
              . All files are automatically deleted after 21 minutes. Checkout
              the{" "}
              <a
                rel="noreferrer"
                target="_blank"
                href="https://youtube.com/c/alexanderalemayhu?sub_confirmation=1"
              >
                YouTube channel for tutorials
              </a>
              . Notion API support is in the works and coming soon!
            </InfoMessage>
            <SettingsModal
              isActive={isSettings}
              onClickClose={() => {
                window.history.pushState({}, "", "upload");
                setShowSettings(false);
              }}
            />
            <hr />
            <div className="my-4">
              <SupportSection />
            </div>
          </div>
        </>
      )}
    </Container>
  );
};

export default UploadPage;
