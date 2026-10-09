import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CreateAccountNotice } from '../../components/CreateAccountNotice/CreateAccountNotice';
import { ConfirmEmailNotice } from '../../components/ConfirmEmailNotice/ConfirmEmailNotice';
import sharedStyles from '../../styles/shared.module.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Variant({
  title,
  children,
}: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
    >
      <h2 className={sharedStyles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

export default function UploadSuccessPreviewPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <div
        className={sharedStyles.page}
        style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}
      >
        <h1>Success-offer slot preview</h1>
        <p>
          The success state renders at most one of these, resolved by
          resolveSuccessOffer: anonymous → account offer, signed-in but
          unverified → confirm-email offer, verified → nothing.
        </p>
        <Variant title="Anonymous — account offer (named deck)">
          <CreateAccountNotice deckName="Pharmacology Week 3" />
        </Variant>
        <Variant title="Anonymous — account offer (untitled deck)">
          <CreateAccountNotice />
        </Variant>
        <Variant title="Signed in, unverified — confirm email (named deck)">
          <ConfirmEmailNotice
            email="al@example.com"
            deckName="Pharmacology Week 3"
          />
        </Variant>
        <Variant title="Signed in, unverified — confirm email (untitled deck)">
          <ConfirmEmailNotice email="al@example.com" />
        </Variant>
        <Variant title="Verified — no card">
          <p>(nothing renders)</p>
        </Variant>
      </div>
    </QueryClientProvider>
  );
}
