// Lightweight HTML → plain text. The app has no HTML renderer (no
// react-native-render-html / WebView), and CMS/blog content ships as HTML,
// so we degrade gracefully to readable paragraphs: block tags become line
// breaks, inline tags are stripped, common entities decoded.

const BLOCK_BREAK =
  /<\/(p|div|h[1-6]|li|ul|ol|tr|table|blockquote|section|article)\s*>/gi;
const BR = /<br\s*\/?>/gi;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&rdquo;': '”',
  '&ldquo;': '“',
};

export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let s = html;
  // Drop script/style blocks entirely.
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Block-level closes + <br> → newlines.
  s = s.replace(BR, '\n').replace(BLOCK_BREAK, '\n');
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, '');
  // Decode entities.
  s = s.replace(/&[a-z#0-9]+;/gi, m => ENTITIES[m.toLowerCase()] ?? m);
  // Collapse 3+ newlines to a paragraph gap, trim trailing spaces per line.
  s = s
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}
