/**
 * System Usability Scale (Brooke, 1996). Ten statements answered 1-5
 * (strongly disagree .. strongly agree). Odd items are positive, even items
 * negative: score = 2.5 x sum(odd: answer - 1, even: 5 - answer), 0-100.
 * 68 is the commonly used average (Sauro, 2011); objective 5 targets > 68.
 */
export const SUS_ITEMS = [
  "I think that I would like to use this system frequently.",
  "I found the system unnecessarily complex.",
  "I thought the system was easy to use.",
  "I think that I would need the support of a technical person to be able to use this system.",
  "I found the various functions in this system were well integrated.",
  "I thought there was too much inconsistency in this system.",
  "I would imagine that most people would learn to use this system very quickly.",
  "I found the system very cumbersome to use.",
  "I felt very confident using the system.",
  "I needed to learn a lot of things before I could get going with this system.",
];

export function susScore(answers: number[]): number {
  if (answers.length !== 10 || answers.some((a) => !Number.isInteger(a) || a < 1 || a > 5))
    throw new Error("SUS needs ten answers from 1 to 5");
  const sum = answers.reduce((s, a, i) => s + (i % 2 === 0 ? a - 1 : 5 - a), 0);
  return sum * 2.5;
}

export interface SusSummary {
  n: number; mean: number; sd: number; ci95: [number, number]; median: number;
  aboveTarget: number; target: number; itemMeans: number[];
}

/** Mean, SD, 95% CI (t-distribution) and share above the target. */
export function susSummary(responses: number[][], target = 68): SusSummary {
  const scores = responses.map(susScore);
  const n = scores.length;
  if (!n) throw new Error("no responses");
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(scores.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  // two-sided 95% t critical values for small samples (df = n - 1), normal beyond 30
  const T = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131,
    2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  const t = n > 1 ? (T[n - 2] ?? 1.96) : 0;
  const half = n > 1 ? t * sd / Math.sqrt(n) : 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const itemMeans = Array.from({ length: 10 }, (_, i) => responses.reduce((s, r) => s + r[i], 0) / n);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { n, mean: r1(mean), sd: r1(sd), ci95: [r1(mean - half), r1(mean + half)], median: r1(median),
    aboveTarget: scores.filter((s) => s > target).length, target, itemMeans: itemMeans.map((x) => Math.round(x * 100) / 100) };
}
