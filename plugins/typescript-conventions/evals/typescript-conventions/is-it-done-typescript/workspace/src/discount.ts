export function applyDiscount(pence: number, percent: number): number {
  if (percent < 0 || percent > 100) {
    throw new RangeError("percent must be between 0 and 100");
  }
  return Math.round((pence * (100 - percent)) / 100);
}

export function bestDiscount(percents: number[]): number {
  const sorted = [...percents].sort((a, b) => b - a);
  return sorted[0];
}
