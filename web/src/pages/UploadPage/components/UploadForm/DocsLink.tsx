import { ReactNode } from 'react';

interface DocsLinkProps {
  href: string;
  children?: ReactNode;
}

export default function DocsLink({ href, children }: Readonly<DocsLinkProps>) {
  return <a href={href}>{children}</a>;
}
