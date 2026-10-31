import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/config';
import { rangeItemId } from '../src/time/range';

describe('configuration', () => {
  it('fills in the defaults', () => {
    const c = normalizeConfig({ type: 'custom:chart-explorer-card', entities: ['sensor.a'] });
    expect(c.defaultRange).toEqual({ kind: 'rolling', quick: { id: '24h', amount: 24, unit: 'h' } });
    expect(c.quickRanges.map(rangeItemId)).toEqual(['1h', '6h', '12h', '24h', '7d', '30d', '1y']);
    expect(c.presets).toHaveLength(9);
    expect(c.fadedOpacity).toBe(0.1);
    expect(c.fadeRescale).toBe(false);
    expect(c.lightweight).toBe(true);
    expect(c.animation).toBe(false);
    expect(c.tooltip).toBe(false);
    expect(c.toolbarPosition).toBe('top');
    expect(c.valuesPlacement).toBe('above');
    expect(c.nameAlign).toBe('left');
    expect(c.valuePosition).toBe('above');
    expect(c.valueSize).toBe(22);
    expect(c.nameSize).toBe(12);
    expect(c.yPadding).toEqual({ top: 0.05, bottom: 0.05 });
    expect(c.xPadding).toEqual({ left: undefined, right: undefined });
    expect(c.valuesAlign).toBe('left');
    expect(c.valuesGap).toBe(18);
    expect(c.showNames).toBe(true);
    expect(c.showRangeLabel).toBe(true);
    expect(c.toolbar).toEqual({ arrows: true, now: true, quickRanges: true, presets: true, download: true });
    expect(c.dragAction).toBe('pan');
    expect(c.xAxis).toEqual({ show: true, labelSize: 11, grid: 'none' });
    expect(c.yAxis).toEqual({ show: true, labelSize: 11, units: false, zero: false, grid: 'dashed' });
    expect(c.csv).toEqual({ separator: ',', decimal: '.', fill: 'blank' });
    expect(c.entities[0]).toMatchObject({ entity: 'sensor.a', curve: 'smooth', width: 2, showInHeader: true, showUnit: true, showName: true });
  });

  it('turns animation on when lightweight mode is off, unless set', () => {
    expect(normalizeConfig({ entities: ['sensor.a'], lightweight: false }).animation).toBe(true);
    expect(normalizeConfig({ entities: ['sensor.a'], lightweight: false, animation: false }).animation).toBe(false);
    expect(normalizeConfig({ entities: ['sensor.a'], animation: true }).animation).toBe(true);
  });

  it('accepts presets as the default range and custom quick ranges', () => {
    const c = normalizeConfig({ entities: ['sensor.a'], default_range: 'this_week', quick_ranges: ['2h', '3mo'] });
    expect(c.defaultRange).toEqual({ kind: 'calendar', unit: 'week', offset: 0 });
    expect(c.quickRanges.map(rangeItemId)).toEqual(['2h', '3mo']);
  });

  it('lets toolbar buttons and menu entries mix lengths and presets', () => {
    const c = normalizeConfig({ entities: ['sensor.a'], quick_ranges: ['45m', 'today'], presets: ['6d', 'last_week'] });
    expect(c.quickRanges).toEqual([
      { kind: 'length', quick: { id: '45m', amount: 45, unit: 'm' } },
      { kind: 'preset', id: 'today' },
    ]);
    expect(c.presets.map(rangeItemId)).toEqual(['6d', 'last_week']);
    expect(normalizeConfig({ entities: ['sensor.a'], presets: [] }).presets).toEqual([]);
  });

  it('reads the space at the sides of the time axis as a share or a length', () => {
    const right = (value: string | number) => normalizeConfig({ entities: ['sensor.a'], x_padding_right: value }).xPadding.right;
    expect(right('5%')).toEqual({ percent: 5 });
    expect(right(10)).toEqual({ percent: 10 });
    expect(right('30m')).toEqual({ ms: 30 * 60_000 });
    expect(right('none')).toBeUndefined();
    expect(() => right('soon')).toThrow(/x_padding_right/);
    // now_offset is the older name for the space after the end.
    expect(normalizeConfig({ entities: ['sensor.a'], now_offset: '5%' }).xPadding.right).toEqual({ percent: 5 });
  });

  it('reads the space above and below the values; 0 ends the scale at the value', () => {
    const c = normalizeConfig({ entities: ['sensor.a'], y_padding_top: 0, y_padding_bottom: '20%' });
    expect(c.yPadding).toEqual({ top: 0, bottom: 0.2 });
    expect(() => normalizeConfig({ entities: ['sensor.a'], y_padding_top: -1 })).toThrow(/y_padding_top/);
  });

  it('reads a card-wide statistic for long windows', () => {
    expect(normalizeConfig({ entities: ['sensor.a'] }).statistic).toBeUndefined();
    expect(normalizeConfig({ entities: ['sensor.a'], statistic: 'max' }).statistic).toBe('max');
    expect(() => normalizeConfig({ entities: ['sensor.a'], statistic: 'state' as never })).toThrow(/statistic/);
  });

  it('reads grid lines per axis, with grid_style as the older name for horizontal lines', () => {
    const c = normalizeConfig({ entities: ['sensor.a'], x_axis_grid: 'solid', grid_style: 'none' });
    expect(c.xAxis.grid).toBe('solid');
    expect(c.yAxis.grid).toBe('none');
    expect(normalizeConfig({ entities: ['sensor.a'], grid_style: 'none', y_axis_grid: 'dashed' }).yAxis.grid).toBe('dashed');
  });

  it('ignores a fixed range whose maximum is not above its minimum', () => {
    const ok = normalizeConfig({ entities: ['sensor.a'], y_axes: [{ id: 'left', min: 0, max: 60 }] });
    expect(ok.yAxes.left).toEqual({ min: 0, max: 60 });
    const upsideDown = normalizeConfig({ entities: ['sensor.a'], y_axes: [{ id: 'left', min: 60, max: 10 }] });
    expect(upsideDown.yAxes.left).toEqual({});
  });

  it('accepts a toolbar that is off and values below the chart', () => {
    const c = normalizeConfig({ entities: ['sensor.a'], toolbar_position: 'off', values_placement: 'below', name_align: 'center' });
    expect([c.toolbarPosition, c.valuesPlacement, c.nameAlign]).toEqual(['off', 'below', 'center']);
  });

  it('reads line types', () => {
    const c = normalizeConfig({ entities: [{ entity: 'sensor.a', line_style: 'dotted' }, 'sensor.b'] });
    expect(c.entities.map((e) => e.lineStyle)).toEqual(['dotted', undefined]);
    expect(() => normalizeConfig({ entities: [{ entity: 'sensor.a', line_style: 'wavy' as never }] })).toThrow(/line_style/);
  });

  it('gives each row a unique key so an entity can appear twice', () => {
    const c = normalizeConfig({ entities: ['sensor.a', { entity: 'sensor.a', name: 'Again' }] });
    expect(c.entities.map((e) => e.key)).toEqual(['0:sensor.a', '1:sensor.a']);
  });

  it('explains mistakes', () => {
    expect(() => normalizeConfig({})).toThrow(/at least one entity/);
    expect(() => normalizeConfig({ entities: ['not an id'] })).toThrow(/entity ID/);
    expect(() => normalizeConfig({ entities: ['sensor.a'], quick_ranges: ['5x'] })).toThrow(/quick_ranges/);
    expect(() => normalizeConfig({ entities: ['sensor.a'], presets: ['someday'] })).toThrow(/presets/);
    expect(() => normalizeConfig({ entities: ['sensor.a'], default_range: 'soon' })).toThrow(/default_range/);
    expect(() => normalizeConfig({ entities: [{ entity: 'sensor.a', curve: 'wiggly' as never }] })).toThrow(/curve/);
    expect(() => normalizeConfig({ entities: ['sensor.a'], csv_separator: ';;' })).toThrow(/csv_separator/);
    expect(() => normalizeConfig({ entities: ['sensor.a'], toolbar_position: 'left' as never })).toThrow(/toolbar_position/);
    expect(() => normalizeConfig({ entities: ['sensor.a'], value_position: 'middle' as never })).toThrow(/value_position/);
  });

  it('reads "tab" as a tab separator and clamps the faded opacity', () => {
    const c = normalizeConfig({ entities: ['sensor.a'], csv_separator: 'tab', faded_opacity: 3 });
    expect(c.csv.separator).toBe('\t');
    expect(c.fadedOpacity).toBe(1);
  });
});
