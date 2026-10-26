import { Helmet } from 'react-helmet-async';

// App-only pages that crawlers reach through links but should never rank.
export function NoIndex() {
  return (
    <Helmet>
      <meta name="robots" content="noindex" />
    </Helmet>
  );
}
