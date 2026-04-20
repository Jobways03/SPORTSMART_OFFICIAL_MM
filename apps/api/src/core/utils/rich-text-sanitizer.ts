import sanitizeHtml = require('sanitize-html');

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote',
    'a',
    'span',
  ],
  allowedAttributes: {
    a: ['href', 'rel', 'target'],
  },
  allowedSchemes: ['http', 'https'],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        rel: 'nofollow noopener',
        target: '_blank',
      },
    }),
  },
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

export function isRichTextEmpty(sanitizedHtml: string): boolean {
  const plainText = sanitizedHtml
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return plainText.length === 0;
}

export function getPlainTextLength(sanitizedHtml: string): number {
  return sanitizedHtml
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
    .length;
}
