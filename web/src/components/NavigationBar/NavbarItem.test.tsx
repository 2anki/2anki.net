import { render, screen } from '@testing-library/react';
import NavbarItem from './NavbarItem';

describe('NavbarItem', () => {
  it.each([
    ['/upload/', '/upload/'],
    ['/upload', '/upload/'],
    ['/upload/', '/upload'],
  ])('marks the link active on %s for href %s', (path, href) => {
    render(
      <NavbarItem path={path} href={href}>
        Upload
      </NavbarItem>
    );
    expect(screen.getByRole('link', { name: 'Upload' }).className).toMatch(
      /navLinkActive/
    );
  });

  it('leaves other links inactive', () => {
    render(
      <NavbarItem path="/pricing/" href="/upload/">
        Upload
      </NavbarItem>
    );
    expect(screen.getByRole('link', { name: 'Upload' }).className).not.toMatch(
      /navLinkActive/
    );
  });
});
