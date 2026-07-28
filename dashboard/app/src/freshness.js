// Map a freshness value (-1 behind, 0 current, 1 ahead, null unknown) + install mode
// to a badge {label, cls}. Shared by the core banner, freshness panel, and project cards.
export function freshnessBadge({ freshness, latest, installMode }) {
  if (installMode === 'none') return { label: 'not installed', cls: 'bad' };
  if (freshness === 0) return { label: 'up to date', cls: 'ok' };
  if (freshness === -1) return { label: `update → ${latest}`, cls: 'warn' };
  if (freshness === 1) return { label: 'ahead of npm (dev)', cls: 'dev' };
  return { label: 'unknown', cls: 'neutral' };
}
