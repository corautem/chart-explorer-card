/** Units that convert into each other by a factor, so they can share one scale. */
const FAMILIES: Record<string, [family: string, factor: number]> = {
  W: ['power', 1],
  kW: ['power', 1e3],
  MW: ['power', 1e6],
  Wh: ['energy', 1],
  kWh: ['energy', 1e3],
  MWh: ['energy', 1e6],
};

/** Whether two units belong to one family, such as W and kW. */
export function sameFamily(a: string, b: string): boolean {
  return Boolean(FAMILIES[a] && FAMILIES[b] && FAMILIES[a][0] === FAMILIES[b][0]);
}

/** What a value in `from` is multiplied by to draw it in `to`: 0.001 from W to kW; 1 when they do not convert. */
export function unitFactor(from: string, to: string): number {
  if (from === to || !sameFamily(from, to)) return 1;
  return FAMILIES[from][1] / FAMILIES[to][1];
}

/**
 * Values brought into one unit per family, the first such unit met (W and kW
 * into the first of them), so that shares of a pie compare like with like.
 * Units outside the families stay as they are.
 */
export function inCommonUnits(items: { value: number; unit: string }[]): number[] {
  const bases: string[] = [];
  return items.map(({ value, unit }) => {
    if (!sameFamily(unit, unit)) return value;
    let base = bases.find((other) => sameFamily(other, unit));
    if (!base) {
      base = unit;
      bases.push(unit);
    }
    return value * unitFactor(unit, base);
  });
}
