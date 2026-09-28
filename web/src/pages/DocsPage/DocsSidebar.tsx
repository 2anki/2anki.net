import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { findGroupForSlug, localizeGroupLabel, sidebar } from './sidebar';
import { loadDoc } from './loader';
import { DocsSearchTrigger } from './DocsSearchTrigger';
import styles from './DocsPage.module.css';

interface DocsSidebarProps {
  onNavigate?: () => void;
  onSearch?: () => void;
  isDrawer?: boolean;
  activeSlug?: string;
}

export function DocsSidebar({
  onNavigate,
  onSearch,
  isDrawer,
  activeSlug,
}: Readonly<DocsSidebarProps>) {
  const { t, i18n } = useTranslation('docs');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const activeGroupLabel = activeSlug
    ? findGroupForSlug(activeSlug)?.label
    : undefined;

  const itemLabel = (slug: string, fallback: string) =>
    (language === 'de' ? loadDoc(slug, 'de')?.frontmatter.title : undefined) ??
    fallback;

  return (
    <nav
      className={`${styles.sidebar} ${isDrawer ? styles.sidebarDrawer : ''}`}
      aria-label={t('sidebar.label')}
    >
      {onSearch && <DocsSearchTrigger onOpen={onSearch} />}
      {sidebar.map((group) => {
        const isActiveGroup = group.label === activeGroupLabel;
        return (
          <div key={group.label} className={styles.sidebarGroup}>
            <div className={styles.sidebarGroupLabel}>
              {localizeGroupLabel(group.label, language)}
            </div>
            <ul
              className={`${styles.sidebarList} ${
                isActiveGroup ? styles.sidebarListActive : ''
              }`}
            >
              {group.items.map((item) => (
                <li key={item.slug}>
                  {item.href ? (
                    <a
                      href={item.href}
                      className={styles.sidebarLink}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {itemLabel(item.slug, item.label)}
                    </a>
                  ) : (
                    <NavLink
                      to={`/documentation/${item.slug}`}
                      className={({ isActive }) =>
                        `${styles.sidebarLink} ${
                          isActive ? styles.sidebarLinkActive : ''
                        }`
                      }
                      onClick={onNavigate}
                      end
                    >
                      {itemLabel(item.slug, item.label)}
                    </NavLink>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
