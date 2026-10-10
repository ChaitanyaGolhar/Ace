import { useState } from 'react';
import { useServices } from '../../app/services';
import { useQuery } from '../../app/useQuery';
import {
  forecastReadout,
  loadStats,
  perDayReadout,
  shortDate,
  type StatsData,
} from '../../services/stats';

export interface Bar {
  /** 0–1 of the chart height; 0 draws the 2px stub. */
  height: number;
  isToday: boolean;
  /** Accessible name, e.g. "Sun: 3 cards due". */
  label: string;
}

export interface StatsViewModel {
  status: 'loading' | 'error' | 'ready';
  retention: { value: string; caption: string };
  reviews: { value: string; caption: string };
  daysStudied: { value: string; of: string; caption: string };
  forecast: { bars: (Bar & { axis: string })[]; readout: string };
  perDay: { bars: Bar[]; axis: [string, string, string]; readout: string };
  cards: { key: 'learned' | 'learning' | 'not-seen'; label: string; count: number }[];
  focusForecast: (index: number | null) => void;
  focusPerDay: (index: number | null) => void;
}

function heights(counts: number[]): number[] {
  const max = Math.max(...counts, 0);
  return counts.map((c) => (max === 0 ? 0 : c / max));
}

export function toStatsViewModel(
  data: StatsData,
  forecastIndex: number,
  perDayIndex: number,
): Omit<StatsViewModel, 'status' | 'focusForecast' | 'focusPerDay'> {
  const fHeights = heights(data.forecast.map((d) => d.count));
  const pHeights = heights(data.perDay.map((d) => d.count));
  const lastIndex = data.perDay.length - 1;
  const fEntry = data.forecast[forecastIndex] ?? data.forecast[0];
  const pEntry = data.perDay[perDayIndex] ?? data.perDay[lastIndex];
  return {
    retention: {
      value: data.retention.percent === null ? '—' : `${String(data.retention.percent)}%`,
      caption:
        data.retention.percent === null
          ? 'Shows up once you review cards you’ve already learned'
          : 'Cards you’d already learned that you didn’t rate Again',
    },
    reviews: {
      value: String(data.reviews),
      caption:
        data.averagePerStudiedDay === null
          ? 'No reviews in the last 30 days'
          : `About ${String(data.averagePerStudiedDay)} a day on days you studied`,
    },
    daysStudied: {
      value: String(data.daysStudied),
      of: 'of 30',
      caption: 'Missed days don’t reset anything',
    },
    forecast: {
      bars: data.forecast.map((d, i) => ({
        height: fHeights[i] ?? 0,
        isToday: i === 0,
        label: forecastReadout(d),
        axis: d.label,
      })),
      readout: fEntry ? forecastReadout(fEntry) : '',
    },
    perDay: {
      bars: data.perDay.map((d, i) => ({
        height: pHeights[i] ?? 0,
        isToday: i === lastIndex,
        label: perDayReadout(d, i === lastIndex),
      })),
      axis: [
        data.perDay[0] ? shortDate(data.perDay[0].day) : '',
        data.perDay[14] ? shortDate(data.perDay[14].day) : '',
        'Today',
      ],
      readout: pEntry ? perDayReadout(pEntry, perDayIndex === lastIndex) : '',
    },
    cards: [
      { key: 'learned', label: 'Learned · in regular review', count: data.cardsByState.learned },
      { key: 'learning', label: 'Still learning', count: data.cardsByState.learning },
      { key: 'not-seen', label: 'Not seen yet', count: data.cardsByState.notSeen },
    ],
  };
}

export function useStats(): StatsViewModel {
  const { ctx, browserTimeZone } = useServices();
  const query = useQuery(() => loadStats(ctx, { browserTimeZone }), [ctx, browserTimeZone]);
  // Which bar the readout describes: null = the default (today).
  const [forecastFocus, setForecastFocus] = useState<number | null>(null);
  const [perDayFocus, setPerDayFocus] = useState<number | null>(null);

  const empty: Omit<StatsViewModel, 'status' | 'focusForecast' | 'focusPerDay'> = {
    retention: { value: '', caption: '' },
    reviews: { value: '', caption: '' },
    daysStudied: { value: '', of: '', caption: '' },
    forecast: { bars: [], readout: '' },
    perDay: { bars: [], axis: ['', '', ''], readout: '' },
    cards: [],
  };
  const data = query.status === 'ready' ? query.data : null;
  return {
    status: query.status,
    ...(data
      ? toStatsViewModel(data, forecastFocus ?? 0, perDayFocus ?? data.perDay.length - 1)
      : empty),
    focusForecast: setForecastFocus,
    focusPerDay: setPerDayFocus,
  };
}
