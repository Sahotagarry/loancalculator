/** Display the build instant in Vancouver time, regardless of the viewer's timezone. */
export function formatBuildTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(new Date(timestamp));
}
