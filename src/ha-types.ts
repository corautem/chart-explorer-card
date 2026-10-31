// The parts of Home Assistant's frontend objects this card uses.

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & {
    friendly_name?: string;
    unit_of_measurement?: string;
    state_class?: string;
  };
  last_changed: string;
  last_updated: string;
}

export type NumberFormat =
  | 'language'
  | 'system'
  | 'comma_decimal'
  | 'decimal_comma'
  | 'space_comma'
  | 'none';

export type TimeFormat = 'language' | 'system' | '12' | '24';

export type FirstWeekday =
  | 'language'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface FrontendLocale {
  language: string;
  number_format?: NumberFormat;
  time_format?: TimeFormat;
  first_weekday?: FirstWeekday;
}

export interface HomeAssistant {
  states: Record<string, HassEntity | undefined>;
  entities?: Record<string, { display_precision?: number } | undefined>;
  locale: FrontendLocale;
  language?: string;
  themes?: { darkMode?: boolean };
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  connection: {
    subscribeMessage<T>(
      callback: (msg: T) => void,
      msg: Record<string, unknown>,
    ): Promise<() => unknown>;
  };
  formatEntityState?(stateObj: HassEntity, state?: string): string;
}

export interface LovelaceGridOptions {
  columns?: number | 'full';
  rows?: number | 'auto';
  min_columns?: number;
  min_rows?: number;
}
