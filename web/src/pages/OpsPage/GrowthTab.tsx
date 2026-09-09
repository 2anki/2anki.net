import CollapsibleSection from './CollapsibleSection';
import ConversionsTab from './ConversionsTab';
import CustomerSignalsTab from './CustomerSignalsTab';
import LandingPageYieldTab from './LandingPageYieldTab';
import ReturnRateTab from './ReturnRateTab';
import UploadFunnelTab from './UploadFunnelTab';
import { useSectionSummaries } from './useSectionSummary';

export default function GrowthTab() {
  const summaryFor = useSectionSummaries();
  return (
    <>
      <CollapsibleSection
        slug="conversions"
        title="Conversions"
        summary={summaryFor('conversion_success_7d_pct')}
      >
        <ConversionsTab />
      </CollapsibleSection>
      <CollapsibleSection
        slug="upload-funnel"
        title="Upload funnel"
        summary={summaryFor('upload_to_download_7d')}
      >
        <UploadFunnelTab />
      </CollapsibleSection>
      <CollapsibleSection
        slug="landing-page-yield"
        title="Landing page yield"
        summary={summaryFor('signups_7d')}
      >
        <LandingPageYieldTab />
      </CollapsibleSection>
      <CollapsibleSection slug="customer-signals" title="Customer signals">
        <CustomerSignalsTab />
      </CollapsibleSection>
      <CollapsibleSection slug="return-rate" title="Return rate">
        <ReturnRateTab />
      </CollapsibleSection>
    </>
  );
}
