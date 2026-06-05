// Backend categories don't carry icons — this lookup gives the UI
// an emoji to render alongside category names on HomeScreen and
// BrowseScreen. Unknown categories get a generic trophy. Kept in a
// shared util so both screens stay consistent.

export const CATEGORY_EMOJI: Record<string, string> = {
  cricket: '🏏',
  football: '⚽',
  soccer: '⚽',
  running: '🏃',
  gym: '🏋️',
  fitness: '🏋️',
  weightlifting: '🏋️',
  badminton: '🏸',
  tennis: '🎾',
  swimming: '🏊',
  cycling: '🚴',
  yoga: '🧘',
  boxing: '🥊',
  basketball: '🏀',
  golf: '⛳',
  baseball: '⚾',
  hiking: '🥾',
  trekking: '🥾',
  skating: '🛹',
  skateboarding: '🛹',
  activewear: '👟',
  apparel: '👕',
};

export function emojiFor(
  slug: string | null | undefined,
  name: string,
): string {
  const key = (slug ?? name).toLowerCase().trim();
  if (CATEGORY_EMOJI[key]) return CATEGORY_EMOJI[key];
  // Try the first word of the name (e.g. "Cricket Equipment" → "cricket")
  const head = name.toLowerCase().split(/\s+/)[0];
  return CATEGORY_EMOJI[head] ?? '🏆';
}
