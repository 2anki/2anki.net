import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ErrorHandlerType } from '../../../components/errors/helpers/getErrorMessage';
import Backend from '../../../lib/backend';
import NotionObject from '../../../lib/interfaces/NotionObject';
import sharedStyles from '../../../styles/shared.module.css';
import useFavorites from '../helpers/useFavorites';
import searchStyles from '../SearchPage.module.css';
import ListSearchResults from './ListSearchResults';
import SearchBar from './SearchBar';

interface SearchPresenterProps {
  inProgress: boolean;
  myPages: NotionObject[];
  setSearchQuery: (value: string) => void;
  searchQuery: string;
  triggerSearch: (force: boolean) => void;
  setError: ErrorHandlerType;
  workSpace: string | null;
  isLoggedIn: boolean;
}

export default function SearchPresenter(props: Readonly<SearchPresenterProps>) {
  const navigate = useNavigate();
  const { t } = useTranslation('tools');
  const {
    inProgress,
    myPages,
    setSearchQuery,
    searchQuery,
    triggerSearch,
    setError,
    workSpace,
    isLoggedIn,
  } = props;
  const [, setFavorites] = useFavorites(new Backend(), isLoggedIn);
  const showsTopLevelPages = searchQuery.trim() === '' && myPages.length > 0;

  return (
    <>
      <div className={searchStyles.stickyBar}>
        <SearchBar
          value={searchQuery}
          inProgress={inProgress}
          onSearchQueryChanged={(s) => {
            navigate(
              {
                pathname: '/notion',
                search: s ? `?q=${encodeURIComponent(s)}` : '',
              },
              { replace: true }
            );
            setSearchQuery(s);
          }}
          onSearchClicked={() => triggerSearch(false)}
        />
      </div>
      {showsTopLevelPages && (
        <p className={sharedStyles.secondaryText}>
          {t('import.pagePickerHelp')}
        </p>
      )}
      <ListSearchResults
        setError={setError}
        setFavorites={setFavorites}
        results={myPages}
        handleEmpty={!inProgress}
        searchQuery={searchQuery}
        workSpace={workSpace}
      />
    </>
  );
}
