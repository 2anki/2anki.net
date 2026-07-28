import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';
import { StructureRescueRule } from '../helpers/parseStructureRescuedPayload';

interface StructureRescuedNoticeProps {
  rule: StructureRescueRule;
}

export function StructureRescuedNotice({
  rule,
}: Readonly<StructureRescuedNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('structure_rescued_notice_shown', { rule });
  }, [rule]);

  const structure = t(`structureRescued.structures.${rule}`);

  return <p>{t('structureRescued.text', { structure })}</p>;
}
