import AiUsageSection from './AiUsageSection';
import CollapsibleSection from './CollapsibleSection';
import EmailDeliverySection from './EmailDeliverySection';
import EngineeringTab from './EngineeringTab';
import PerformanceTab from './PerformanceTab';
import { useSectionSummaries } from './useSectionSummary';

export default function SystemTab() {
  const summaryFor = useSectionSummaries();
  return (
    <>
      <CollapsibleSection
        slug="engineering"
        title="Engineering"
        summary={summaryFor('unresolved_error_groups')}
      >
        <EngineeringTab />
      </CollapsibleSection>
      <CollapsibleSection slug="performance" title="Performance">
        <PerformanceTab />
      </CollapsibleSection>
      <CollapsibleSection slug="ai-usage" title="AI usage">
        <AiUsageSection />
      </CollapsibleSection>
      <CollapsibleSection slug="email-delivery" title="Email delivery">
        <EmailDeliverySection />
      </CollapsibleSection>
    </>
  );
}
