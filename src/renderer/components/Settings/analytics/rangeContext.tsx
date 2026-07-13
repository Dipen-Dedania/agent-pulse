import { createContext, useContext } from 'react';
import { TimelineRange } from '../../../../common/timeline-types';

// One range scopes every range-aware card on the Analytics tab, so the numbers
// always agree. Cards with an intrinsic window (Daily digest, Claude usage
// value) ignore it. State lives in AnalyticsTab; cards only read.
const RangeContext = createContext<TimelineRange>('30d');

export const AnalyticsRangeProvider = RangeContext.Provider;

export function useGlobalRange(): TimelineRange {
  return useContext(RangeContext);
}

export const RANGE_OPTIONS: { value: TimelineRange; label: string }[] = [
  { value: '7d',  label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '1y',  label: '1y' },
];

export const RANGE_LABEL: Record<TimelineRange, string> = {
  '7d':  'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  '1y':  'last year',
};
