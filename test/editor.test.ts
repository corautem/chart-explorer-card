import { describe, expect, it } from 'vitest';
import * as schemas from '../src/editor/schema';
import { entityFromForm, entityToForm, fromForm, rangeLabel, tidyRangeItems, toForm } from '../src/editor/schema';
import type { CardConfigInput } from '../src/config';

const base: CardConfigInput = { type: 'custom:chart-explorer-card', entities: ['sensor.a'] };

describe('editor form data', () => {
  it('shows every setting with its default', () => {
    const form = toForm(base);
    expect(form).toMatchObject({
      default_range: '24h',
      toolbar_position: 'top',
      height: 250,
      value_position: 'above',
      value_size: 22,
      lightweight: true,
      animation: false,
      faded_opacity: 10,
      quick_ranges: ['1h', '6h', '12h', '24h', '7d', '30d', '1y'],
    });
    expect(form.presets).toHaveLength(9);
  });

  it('saves nothing extra when nothing changed', () => {
    expect(fromForm(toForm(base), base, ['sensor.a'])).toEqual(base);
  });

  it('writes changed settings in a readable order and drops defaults', () => {
    const form = { ...toForm(base), height: 300, title: 'Heating', value_position: 'left', faded_opacity: 25, toolbar_position: 'top' };
    const out = fromForm(form, base, ['sensor.a']);
    expect(Object.keys(out)).toEqual(['type', 'title', 'entities', 'height', 'value_position', 'faded_opacity']);
    expect(out.faded_opacity).toBe(0.25);
  });

  it('keeps options the editor does not show', () => {
    const original = { ...base, some_future_option: 'x' } as CardConfigInput;
    expect(fromForm(toForm(original), original, ['sensor.a'])).toMatchObject({ some_future_option: 'x' });
  });

  it('writes animation only when it differs from what lightweight mode implies', () => {
    const off = { ...toForm(base), lightweight: false, animation: true };
    expect(fromForm(off, base, ['sensor.a'])).toMatchObject({ lightweight: false });
    expect(fromForm(off, base, ['sensor.a']).animation).toBeUndefined();
    const still = { ...toForm(base), lightweight: true, animation: true };
    expect(fromForm(still, base, ['sensor.a']).animation).toBe(true);
  });

  it('tidies toolbar buttons and menu entries: lengths first, shortest first, then presets', () => {
    expect(tidyRangeItems(['7d', 'nonsense', 'today', '1h', '7d', '2w', '3mo', '45m'])).toEqual(['45m', '1h', '7d', '2w', '3mo', 'today']);
    const form = { ...toForm(base), quick_ranges: ['30d', 'today', '45m'], presets: ['last_week', '6d', 'today'] };
    expect(fromForm(form, base, ['sensor.a'])).toMatchObject({
      quick_ranges: ['45m', '30d', 'today'],
      presets: ['today', 'last_week', '6d'],
    });
  });

  it('remembers custom lengths that are switched off, and drops them once switched on', () => {
    const off = fromForm({ ...toForm(base), unused_quick_ranges: ['45m'], unused_presets: ['6d'] }, base, ['sensor.a']);
    expect(off).toMatchObject({ unused_quick_ranges: ['45m'], unused_presets: ['6d'] });
    expect(toForm(off)).toMatchObject({ unused_quick_ranges: ['45m'], unused_presets: ['6d'] });
    const on = fromForm({ ...toForm(off), quick_ranges: ['45m', '1h'] }, off, ['sensor.a']);
    expect(on.quick_ranges).toEqual(['45m', '1h']);
    expect('unused_quick_ranges' in on).toBe(false);
  });

  it('labels ranges for the editor lists', () => {
    expect(rangeLabel('+1d')).toBe('Next day');
    expect(rangeLabel('+6h')).toBe('Next 6 hours');
    expect(rangeLabel('45m')).toBe('Past 45 minutes');
    expect(rangeLabel('1w')).toBe('Past week');
    expect(rangeLabel('last_week')).toBe('Last week');
  });

  it('moves the older grid_style to the horizontal grid lines', () => {
    const old = { ...base, grid_style: 'solid' as const };
    const out = fromForm(toForm(old), old, ['sensor.a']);
    expect(out).toMatchObject({ y_axis_grid: 'solid' });
    expect('grid_style' in out).toBe(false);
  });

  it('saves the card-wide statistic only when set', () => {
    expect(fromForm(toForm(base), base, ['sensor.a']).statistic).toBeUndefined();
    expect(fromForm({ ...toForm(base), statistic: 'max' }, base, ['sensor.a']).statistic).toBe('max');
  });

  it('saves the space inside the chart only when it differs from the defaults', () => {
    expect(toForm(base)).toMatchObject({ y_padding_top: 5, y_padding_bottom: 5, x_padding_left: 0, x_padding_right: 0 });
    const out = fromForm({ ...toForm(base), y_padding_top: 0, x_padding_right: 10 }, base, ['sensor.a']);
    expect(out).toMatchObject({ y_padding_top: 0, x_padding_right: 10 });
    expect('y_padding_bottom' in out).toBe(false);
  });

  it('turns the older now_offset into the space after the end, but keeps a length set in YAML', () => {
    const percent = { ...base, now_offset: '5%' };
    const moved = fromForm(toForm(percent), percent, ['sensor.a']);
    expect(moved).toMatchObject({ x_padding_right: 5 });
    expect('now_offset' in moved).toBe(false);
    const length = { ...base, x_padding_right: '30m' };
    expect(fromForm(toForm(length), length, ['sensor.a']).x_padding_right).toBe('30m');
  });

  it('saves toolbar switches only when turned off', () => {
    expect(fromForm(toForm(base), base, ['sensor.a'])).toEqual(base);
    const out = fromForm({ ...toForm(base), show_now_button: false, show_download: false }, base, ['sensor.a']);
    expect(out).toMatchObject({ show_now_button: false, show_download: false });
    expect('show_arrows' in out).toBe(false);
  });

  it('keeps fixed ranges from YAML as written', () => {
    const original = { ...base, y_axes: [{ id: 'left', min: 0, max: 60 }] };
    expect(fromForm(toForm(original), original, ['sensor.a']).y_axes).toEqual([{ id: 'left', min: 0, max: 60 }]);
  });
});

describe('editor entity data', () => {
  const blue = '#2a78d6';

  it('a plain entity stays a plain ID', () => {
    expect(entityFromForm(entityToForm('sensor.a', blue), 'sensor.a', blue)).toBe('sensor.a');
  });

  it('shows the default colour but saves only a changed one', () => {
    const form = entityToForm('sensor.a', blue);
    expect(form.color).toEqual([42, 120, 214]);
    expect(entityFromForm({ ...form, color: [255, 0, 0] }, 'sensor.a', blue)).toEqual({ entity: 'sensor.a', color: '#ff0000' });
  });

  it('saves the settings that differ from the defaults', () => {
    const form = { ...entityToForm('sensor.a', blue), name: 'Flow', width: 3, curve: 'step', fill: true, show_in_header: false, y_axis: 'right', statistic: 'max' };
    expect(entityFromForm(form, 'sensor.a', blue)).toEqual({
      entity: 'sensor.a',
      name: 'Flow',
      curve: 'step',
      fill: true,
      width: 3,
      y_axis: 'right',
      show_in_header: false,
      statistic: 'max',
    });
  });

  it('saves a line type, and keeps "faded" from YAML though the editor no longer shows it', () => {
    const form = { ...entityToForm({ entity: 'sensor.a', faded: true }, blue), line_style: 'dotted' };
    expect(entityFromForm(form, { entity: 'sensor.a', faded: true }, blue)).toEqual({
      entity: 'sensor.a',
      line_style: 'dotted',
      faded: true,
    });
    expect(entityToForm('sensor.a', blue).line_style).toBe('auto');
  });

  it('saves the unit switch only when it is off', () => {
    expect(entityToForm('sensor.a', blue).show_unit).toBe(true);
    expect(entityFromForm({ ...entityToForm('sensor.a', blue), show_unit: false }, 'sensor.a', blue)).toEqual({
      entity: 'sensor.a',
      show_unit: false,
    });
  });

  it('saves the name switch only when it is off, and the card-wide one the same way', () => {
    expect(entityToForm('sensor.a', blue).show_name).toBe(true);
    expect(entityFromForm({ ...entityToForm('sensor.a', blue), show_name: false }, 'sensor.a', blue)).toEqual({
      entity: 'sensor.a',
      show_name: false,
    });
    const config = { type: 'custom:chart-explorer-card', entities: ['sensor.a'] };
    expect(fromForm({ ...toForm(config), show_names: true }, config, ['sensor.a']).show_names).toBeUndefined();
    expect(fromForm({ ...toForm(config), show_names: false }, config, ['sensor.a']).show_names).toBe(false);
  });

  it('keeps entity options the editor does not show', () => {
    const original = { entity: 'sensor.a', future: 1 } as unknown as { entity: string };
    expect(entityFromForm(entityToForm(original, blue), original, blue)).toEqual({ entity: 'sensor.a', future: 1 });
  });
});

describe('editor layout', () => {
  type Field = { name?: string; type?: string; schema?: Field[]; selector?: Record<string, { mode?: string }> };
  // Home Assistant draws these kinds at different heights; a row may only hold one kind.
  const kind = (f: Field) => {
    const selector = f.selector ?? {};
    if ('boolean' in selector) return 'switch';
    if ('number' in selector && selector.number.mode === 'slider') return 'slider';
    if ('select' in selector) return 'dropdown';
    return 'box';
  };
  const forms: Field[][] = [
    schemas.generalSchema(toForm(base)),
    schemas.LAYOUT_SCHEMA,
    schemas.VALUES_SCHEMA,
    schemas.CHART_SCHEMA,
    schemas.X_AXIS_SCHEMA,
    schemas.Y_AXIS_SCHEMA,
    schemas.SPACE_SCHEMA,
    schemas.PERFORMANCE_SCHEMA,
    schemas.DATA_SCHEMA,
    schemas.STATISTIC_SCHEMA,
    schemas.CSV_SCHEMA,
    schemas.BARS_SCHEMA,
    schemas.TIMELINE_SCHEMA,
    schemas.entitySchema(),
    schemas.entitySchema('bar'),
    schemas.entitySchema('timeline', 'timeline'),
    schemas.entitySchema('band', 'timeline', ['on', 'off']),
  ] as Field[][];

  it('pairs only fields of the same kind, and never switches or sliders', () => {
    for (const form of forms) {
      for (const row of form.filter((f) => f.type === 'grid')) {
        const kinds = (row.schema ?? []).map(kind);
        expect(kinds.every((k) => k === kinds[0]), kinds.join(' + ')).toBe(true);
        expect(['dropdown', 'box']).toContain(kinds[0]);
      }
    }
  });
});
