import { Link, Route, Switch } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";

import Backend from "../lib/Backend";
import SearchBar from "../components/Dashboard/SearchBar";
import SearchObjectEntry from "../components/Dashboard/SearchObjectEntry";

let backend = new Backend();

const DashboardContent = () => {
  const [query, setQuery] = useState(localStorage.getItem("_query") || "");
  const [myPages, setMyPages] = useState([]);
  const [inProgress, setInProgress] = useState(false);
  const triggerSearch = useCallback(() => {
    if (inProgress) {
      return;
    }
    setInProgress(true);
    backend
      .search(query)
      .then((results) => {
        if (results && results.length > 0) {
          localStorage.setItem("__my_pages", JSON.stringify(results));
        }
        setMyPages(results);
        setInProgress(false);
      })
      .catch((error) => {
        setInProgress(false);
        // TODO: handle this error
        console.error(error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (query && query.length > 3) {
      triggerSearch();
      console.log(query);
    }
  }, [query, triggerSearch]);

  return (
    <div className="column is-main-content">
      <Switch>
        <Route exact path="/dashboard/workspaces">
          Workspaces is coming soon!
        </Route>
        <Route path="/dashboard">
          <SearchBar
            inProgress={inProgress}
            onSearchQueryChanged={(s) => setQuery(s)}
            onSearchClicked={triggerSearch}
          />
          {(!myPages || myPages.length < 1) && (
            <>
              <div className="subtitle is-2 my-4">😣 ↩️ 🆔 🆙 🖱 🔍.</div>
              {query && query.length && (
                <>
                  <button
                    className="button"
                    onClick={() => alert("to be implemented")}
                  >
                    Create Page: {query}
                  </button>
                </>
              )}
            </>
          )}
          {myPages &&
            myPages.length > 0 &&
            myPages.map((p) => (
              <SearchObjectEntry
                key={p.url}
                title={p.title}
                icon={p.icon}
                url={p.url}
                id={p.id}
              />
            ))}
        </Route>
      </Switch>
    </div>
  );
};

const DashboardPage = () => {
  const [connectionLink, updateConnectionLink] = useState("");
  const [connected, updateConnected] = useState(true);

  const [loading, setIsLoading] = useState(false);

  // TODO: this just be served up from the server (in-line)
  useEffect(() => {
    backend
      .getNotionConnectionInfo()
      .then((response) => {
        let data = response.data;
        if (data && !data.isConnected) {
          updateConnectionLink(data.link);
        } else if (data.isConnected) {
          updateConnected(data.isConnected);
        }
        setIsLoading(false);
      })
      .catch((error) => {
        console.error(error);
        // TODO: better handle this
        // alert(
        //   "Failed to get Notion link, please refresh or contact developer: " +
        //     error.message
        // );
      });
  }, []);

  if (loading) {
    return <p>Loading ...</p>;
  }

  return (
    <>
      {!connected && (
        <div>
          <a
            className="button is-link has-text-weight-semibold	"
            href={connectionLink}
          >
            Connect to Notion
          </a>
        </div>
      )}
      {connected && (
        <section className="columns is-fullheight">
          {/* <SideBar menuItem={menuItem} setMenuItem={setMenuItem} /> */}
          <DashboardContent />
        </section>
      )}
    </>
  );
};

export default DashboardPage;
