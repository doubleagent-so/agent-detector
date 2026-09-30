/** Small numeric helpers shared by the behaviour feature extractors. */
export const mean = (values: number[]): number => (values.length ? values.reduce((sum, x) => sum + x, 0) / values.length : 0);
export const std = (values: number[]): number => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, x) => sum + (x - average) ** 2, 0) / (values.length - 1));
};
export const cv = (values: number[]): number => { const average = mean(values); return average > 0 ? std(values) / average : 0; };
export const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const i = sorted.length >> 1;
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
export const r3 = (x: number): number => Math.round(x * 1000) / 1000;
