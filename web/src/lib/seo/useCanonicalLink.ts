import { useEffect } from 'react';

const CANONICAL_SELECTOR = 'link[rel="canonical"]';

// A prerendered page ships its canonical in the HTML. A lazily loaded page that
// renders one through Helmet gets a second tag beside it, because React only
// adopts existing head tags outside a suspended subtree. Owning the one tag
// here keeps exactly one canonical, on a direct load and after navigation.
export function useCanonicalLink(href: string | undefined): void {
  useEffect(() => {
    if (href == null) {
      return undefined;
    }
    const [existing, ...stale] = Array.from(
      document.head.querySelectorAll<HTMLLinkElement>(CANONICAL_SELECTOR)
    );
    for (const link of stale) {
      link.remove();
    }
    const link = existing ?? document.createElement('link');
    link.setAttribute('rel', 'canonical');
    link.setAttribute('href', href);
    if (existing == null) {
      document.head.appendChild(link);
    }
    return () => link.remove();
  }, [href]);
}
