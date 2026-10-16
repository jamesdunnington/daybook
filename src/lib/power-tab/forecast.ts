// Milestone pace-based forecast: extrapolates a finish date from recent logged
// pace rather than a manually-updated progress bar. See the design doc
// (docs/superpowers/specs/2026-10-16-power-tab-design.md) for the rationale.

export interface ForecastInput {
  targetCount: number;
  progressSoFar: number;
  /** countValue + entryDate pairs for activity-log entries linked to this milestone. */
  entries: Array<{ countValue: number; entryDate: Date }>;
}

export interface Forecast {
  progressSoFar: number;
  targetCount: number;
  percentComplete: number;
  remaining: number;
  /** Units per day, averaged over the last 30 days of logged entries. Null if no pace data. */
  pacePerDay: number | null;
  forecastDate: Date | null;
  note: string;
}

const PACE_WINDOW_DAYS = 30;

export function computeMilestoneForecast(input: ForecastInput): Forecast {
  const { targetCount, progressSoFar, entries } = input;
  const remaining = Math.max(targetCount - progressSoFar, 0);
  const percentComplete = targetCount > 0 ? Math.min((progressSoFar / targetCount) * 100, 100) : 0;

  if (remaining <= 0) {
    return {
      progressSoFar,
      targetCount,
      percentComplete: 100,
      remaining: 0,
      pacePerDay: null,
      forecastDate: null,
      note: 'Target reached.',
    };
  }

  const windowStart = new Date(Date.now() - PACE_WINDOW_DAYS * 86400_000);
  const recentSum = entries
    .filter((e) => e.entryDate >= windowStart)
    .reduce((sum, e) => sum + e.countValue, 0);

  if (recentSum <= 0) {
    return {
      progressSoFar,
      targetCount,
      percentComplete,
      remaining,
      pacePerDay: null,
      forecastDate: null,
      note: 'Not enough recent activity to forecast a finish date yet.',
    };
  }

  const pacePerDay = recentSum / PACE_WINDOW_DAYS;
  const daysToFinish = remaining / pacePerDay;
  const forecastDate = new Date(Date.now() + daysToFinish * 86400_000);

  return {
    progressSoFar,
    targetCount,
    percentComplete,
    remaining,
    pacePerDay,
    forecastDate,
    note: `Based on the last ${PACE_WINDOW_DAYS} days' pace (${pacePerDay.toFixed(2)}/day).`,
  };
}
