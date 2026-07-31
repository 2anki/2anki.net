import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../../lib/analytics/track';
import { StructureRescueRule } from '../helpers/parseStructureRescuedPayload';

interface StructureRescuedNoticeProps {
  rule: StructureRescueRule;
  source?: 'notion' | 'upload';
}

export function StructureRescuedNotice({
  rule,
  source = 'notion',
}: Readonly<StructureRescuedNoticeProps>) {
  const { t } = useTranslation('downloadsx');

  useEffect(() => {
    track('structure_rescued_notice_shown', { rule, source });
  }, [rule, source]);

  const structure = t(`structureRescued.structures.${rule}`);

  return <p>{t('structureRescued.text', { structure })}</p>;
}
