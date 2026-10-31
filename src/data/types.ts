import type { TimeWindow } from '../time/range';

export type Resolution = 'raw' | '5minute' | 'hour' | 'day' | 'week';

/** Points in time order. NaN values are gaps: unavailable, unknown or text states. */
export interface Series {
  t: number[];
  v: number[];
  /** The state text of each point, kept for entities drawn as a timeline or band. */
  s?: string[];
  /** Per-point lowest and highest value, present for averaged statistics. */
  min?: number[];
  max?: number[];
}

/** Statistics buckets as columns; `t` is each bucket's start. */
export interface StatColumns {
  t: number[];
  mean: number[];
  min: number[];
  max: number[];
  state: number[];
}

export interface EntityData {
  entityId: string;
  /**
   * Raw history. With statistics this holds only the part after the last
   * bucket, so the line reaches the present; live states are appended here.
   */
  raw: Series;
  stats?: StatColumns;
  /** True for measurements (averaged), false for meters (running totals). */
  meanType: boolean;
  statisticsUnit?: string;
  error?: string;
}

/** Values per period (hour, day, week or month), for bars, pies and heatmaps. */
export interface Buckets {
  /** Start and end of each period. */
  t: number[];
  end: number[];
  mean: number[];
  min: number[];
  max: number[];
  /** How much a meter rose in each period. */
  change: number[];
}

export type BucketPeriod = 'hour' | 'day' | 'week' | 'month';

export interface BucketData {
  period: BucketPeriod;
  entities: Map<string, { buckets: Buckets; meanType: boolean; unit?: string }>;
}

export interface LoadedData {
  window: TimeWindow;
  resolution: Resolution;
  loadedAt: number;
  entities: Map<string, EntityData>;
  /** Present when the card draws bars, a pie or a heatmap. */
  buckets?: BucketData;
}
