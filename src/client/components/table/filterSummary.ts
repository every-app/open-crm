/**
 * A set filter's values as its token reads them: "Ana Lee", "Software,
 * Logistics", or "Software, Logistics +2" once there are more than two.
 */
export function filterSummary(labels: string[]): string {
  const named = labels.slice(0, 2).join(", ");
  return labels.length > 2 ? `${named} +${labels.length - 2}` : named;
}
