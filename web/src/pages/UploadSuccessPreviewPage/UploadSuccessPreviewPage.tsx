import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CreateAccountNotice } from '../../components/CreateAccountNotice/CreateAccountNotice';
import { PassLadderCard } from '../../components/PassLadderCard/PassLadderCard';
import { UpsellCard } from '../../components/UpsellCard';
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
          The success state renders exactly one of these, resolved by
          resolveSuccessOffer: anonymous → account offer, ladder-eligible → pass
          ladder, logged-in free → pass upsell, paying → nothing.
        </p>
        <Variant title="Anonymous — account offer">
          <CreateAccountNotice />
        </Variant>
        <Variant title="Repeat pass buyer — pass ladder">
          <PassLadderCard offerOverride={{ passCount: 3, spentUsd: 13 }} />
        </Variant>
        <Variant title="Logged-in free — pass upsell">
          <UpsellCard surface="upload_success_upsell" />
        </Variant>
        <Variant title="Paying — no card">
          <p>(nothing renders)</p>
        </Variant>
      </div>
    </QueryClientProvider>
  );
}
