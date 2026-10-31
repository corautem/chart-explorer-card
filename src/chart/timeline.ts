import type { Series } from '../data/types';

export interface Segment {
  start: number;
  end: number;
  state: string;
}

/**
 * The stretches of time each state held inside [start, end), with repeats
 * merged. Stretches shorter than `minLength` (about a pixel) are pooled with
 * their neighbours and shown as the state that held longest among them, so a
 * state that flips every few seconds still draws in a few hundred rectangles.
 */
export function timelineSegments(series: Series, start: number, end: number, minLength: number): Segment[] {
  const { t, s } = series;
  const out: Segment[] = [];
  if (!s || end <= start) return out;
  const push = (segment: Segment) => {
    const last = out[out.length - 1];
    if (last && last.state === segment.state && last.end >= segment.start) last.end = segment.end;
    else out.push(segment);
  };
  let pool: { start: number; end: number; time: Map<string, number> } | undefined;
  const flush = () => {
    if (!pool) return;
    let best = '';
    let longest = -1;
    for (const [state, time] of pool.time) {
      if (time > longest) {
        best = state;
        longest = time;
      }
    }
    push({ start: pool.start, end: pool.end, state: best });
    pool = undefined;
  };
  for (let i = 0; i < t.length; i++) {
    const from = Math.max(t[i], start);
    const to = Math.min(i + 1 < t.length ? t[i + 1] : end, end);
    if (to <= from) continue;
    const state = s[i] ?? '';
    if (to - from >= minLength && !pool) {
      push({ start: from, end: to, state });
      continue;
    }
    pool ??= { start: from, end: from, time: new Map() };
    pool.end = to;
    pool.time.set(state, (pool.time.get(state) ?? 0) + (to - from));
    if (pool.end - pool.start >= minLength) flush();
  }
  flush();
  return out;
}

/** How long each state held inside [start, end), for pie charts of states. */
export function stateDurations(series: Series, start: number, end: number): Map<string, number> {
  const totals = new Map<string, number>();
  for (const segment of timelineSegments(series, start, end, 0)) {
    totals.set(segment.state, (totals.get(segment.state) ?? 0) + segment.end - segment.start);
  }
  return totals;
}

export interface PeriodStates {
  start: number;
  end: number;
  /** Time in each state inside the period, in milliseconds. */
  durations: Map<string, number>;
}

/**
 * How long each state held in each period between consecutive `edges`, up to
 * `until`. Periods with no recorded state are left out.
 */
export function periodStates(series: Series, edges: number[], until: number): PeriodStates[] {
  const out: PeriodStates[] = [];
  if (edges.length < 2) return out;
  const segments = timelineSegments(series, edges[0], Math.min(until, edges[edges.length - 1]), 0);
  let k = 0;
  for (const segment of segments) {
    let from = segment.start;
    while (from < segment.end) {
      while (k + 2 < edges.length && edges[k + 1] <= from) k++;
      const to = Math.min(segment.end, edges[k + 1]);
      let period = out[out.length - 1];
      if (period?.start !== edges[k]) {
        period = { start: edges[k], end: edges[k + 1], durations: new Map() };
        out.push(period);
      }
      period.durations.set(segment.state, (period.durations.get(segment.state) ?? 0) + to - from);
      from = to;
    }
  }
  return out;
}

/** The state that held longest; the first of equals. */
export function mainState(durations: Map<string, number>): string | undefined {
  let best: string | undefined;
  let longest = -1;
  for (const [state, time] of durations) {
    if (time > longest) {
      best = state;
      longest = time;
    }
  }
  return best;
}
