import { Link, useLocation } from "react-router-dom";

import WarningMessage from "../components/WarningMessage";
import UploadForm from "../components/UploadForm";
import CardOptions from "../components/CardOptions";
import TemplateOptions from "../components/TemplateOptions";
import DeckOptions from "../components/DeckOptions";
import { useEffect } from "react";

import CARD_OPTIONS from "../model/Options";

// A custom hook that builds on useLocation to parse
// the query string for you.
// Reference: https://reactrouter.com/web/example/query-parameters
function useQuery() {
  return new URLSearchParams(useLocation().search);
}

const UploadPage = () => {
  const isDevelopment = window.location.host !== "2anki.net";
  const query = useQuery();
  const view = query.get("view");

  const isUpload = view === "upload" || !view;
  const isCard = view === "card-options";
  const isTemplate = view === "template";
  const isDeck = view === "deck-options";

  // Make sure the defaults are set if not present to ensure backwards compatability
  useEffect(() => {
    for (const option of CARD_OPTIONS) {
      const value = localStorage.getItem(option.key);
      if (value === null) {
        localStorage.setItem(option.key, option.default.toString());
      }
    }
  }, []);

  return (
    <div style={{ paddingTop: "4rem" }}>
      {isDevelopment ? <WarningMessage /> : null}
      <div className="tabs is-centered is-boxed">
        <ul>
          <li className={`${isUpload ? "is-active" : null}`}>
            <Link to="upload?view=upload">Upload</Link>
          </li>
          <li className={`${isTemplate ? "is-active" : null}`}>
            <Link to="upload?view=template">Template</Link>
          </li>
          <li className={`${isDeck ? "is-active" : null}`}>
            <Link to="upload?view=deck-options">Deck</Link>
          </li>
          <li className={`${isCard ? "is-active" : null}`}>
            <Link to="upload?view=card-options">Card</Link>
          </li>
        </ul>
      </div>
      <div className="container">
        {isUpload ? <UploadForm /> : null}
        {isCard ? <CardOptions /> : null}
        {isTemplate ? <TemplateOptions /> : null}
        {isDeck ? <DeckOptions /> : null}
      </div>
    </div>
  );
};

export default UploadPage;
