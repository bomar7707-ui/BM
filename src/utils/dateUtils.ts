export function formatCzechDate(dateString?: string | null): string {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) {
    // If it's already in Czech format e.g. "12. 5. 2024"
    return String(dateString);
  }
  return d.toLocaleDateString('cs-CZ');
}

export function parseSafeDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;

  // Handle DD. MM. YYYY or D. M. YYYY
  const parts = str.split('.');
  if (parts.length >= 3) {
    const yearStr = parts[2].trim().split(/\s+/)[0];
    const year = parseInt(yearStr, 10);
    const month = parseInt(parts[1].trim(), 10) - 1;
    const day = parseInt(parts[0].trim(), 10);
    const parsed = new Date(year, month, day);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export function getDisplayDateRange(hike: { date?: string; dateTo?: string; rawDate?: string; endDate?: string }): string {
  const startRaw = hike.rawDate || hike.date || '';
  const endRaw = hike.endDate || hike.dateTo || '';

  // Check if string already contains a dash range
  if (typeof startRaw === 'string' && (startRaw.includes(' – ') || startRaw.includes(' - ')) && !endRaw) {
    return startRaw;
  }

  const startFormatted = formatCzechDate(startRaw);
  const endFormatted = endRaw && endRaw !== startRaw ? formatCzechDate(endRaw) : '';

  if (endFormatted && endFormatted !== startFormatted) {
    return `${startFormatted} – ${endFormatted}`;
  }
  return startFormatted;
}
