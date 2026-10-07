/**
 * Natural sort comparator for zone names.
 *
 * Zone names typically embed a number (e.g. "Zone 1", "Zone 2", "Zone 10").
 * A plain alphabetical sort puts "Zone 10" before "Zone 2"; using
 * localeCompare with `numeric: true` sorts the embedded numbers by value,
 * giving smallest → largest.
 */
export function compareZoneNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
