import { describe, expect, it } from 'vitest';

// Node has no canvas; toRgb reads non-hex colours through a canvas probe it keeps after the first call,
// so the stand-in must exist before the first test. fillStyle reads back the text it was given.
(globalThis as any).document = { createElement: () => ({ getContext: () => ({ fillStyle: '' }) }) };

const { entityFromForm, entityToForm, valuesFromForm } = await import('../src/editor/schema');

const blue = '#2a78d6';

describe('editor colours written by hand', () => {
  const item = { entity: 'sensor.a', color: 'rgba(40, 120, 200, 0.3)' };

  it('keeps an rgba() colour while the picker still shows it', () => {
    const form = { ...entityToForm(item, blue), name: 'Flow' };
    expect(entityFromForm(form, item, blue)).toMatchObject({ color: 'rgba(40, 120, 200, 0.3)', name: 'Flow' });
  });

  it('saves hex once another colour is picked', () => {
    const form = { ...entityToForm(item, blue), color: [200, 40, 40] };
    expect(entityFromForm(form, item, blue)).toMatchObject({ color: '#c82828' });
  });

  it('keeps an attribute value colour while the picker still shows it', () => {
    const previous = [{ key: 'low', color: 'rgba(40, 120, 200, 0.3)' }];
    const out = valuesFromForm({ 'on:low': true, 'color:low': [40, 120, 200] }, ['low'], previous, blue);
    expect(out[0].color).toBe('rgba(40, 120, 200, 0.3)');
  });
});
