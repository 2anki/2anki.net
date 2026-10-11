import React from 'react';
import styles from './NavigationBar.module.css';

export interface NavbarItemProps {
  path: string;
  href: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  children: React.ReactNode;
}

const withoutTrailingSlash = (value: string) =>
  value.length > 1 ? value.replace(/\/$/, '') : value;

export default function NavbarItem({
  path,
  href,
  onClick,
  children,
}: Readonly<NavbarItemProps>) {
  return (
    <a
      onClick={onClick}
      href={href}
      className={`${styles.navLink} ${
        withoutTrailingSlash(path) === withoutTrailingSlash(href)
          ? styles.navLinkActive
          : ''
      }`}
    >
      {children}
    </a>
  );
}
