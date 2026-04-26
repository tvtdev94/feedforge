/** Truncate `summary` to `max` chars total. For `max < 4` the ellipsis won't
 *  fit, so hard-slice without the marker. */
export function truncateSummary(summary: string, max: number | null): string {
  if (max === null || summary.length <= max) return summary;
  if (max < 4) return summary.slice(0, max);
  return summary.slice(0, max - 3) + '...';
}
