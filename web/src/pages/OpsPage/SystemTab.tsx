import EngineeringTab from './EngineeringTab';
import PerformanceTab from './PerformanceTab';
import AiUsageSection from './AiUsageSection';
import styles from './OpsPage.module.css';

export default function SystemTab() {
  return (
    <>
      <section
        className={styles.compositeSection}
        aria-labelledby="system-ai-usage"
      >
        <h2 id="system-ai-usage" className={styles.compositeHeading}>
          AI usage
        </h2>
        <AiUsageSection />
      </section>

      <section
        className={styles.compositeSection}
        aria-labelledby="system-engineering"
      >
        <h2 id="system-engineering" className={styles.compositeHeading}>
          Engineering
        </h2>
        <EngineeringTab />
      </section>

      <section
        className={styles.compositeSection}
        aria-labelledby="system-performance"
      >
        <h2 id="system-performance" className={styles.compositeHeading}>
          Performance
        </h2>
        <PerformanceTab />
      </section>
    </>
  );
}
