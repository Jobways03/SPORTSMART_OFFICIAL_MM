import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote',
  'a',
  'span',
];

const ALLOWED_ATTR = ['href', 'rel', 'target'];

/**
 * Client-side defense-in-depth sanitizer for seller-authored HTML
 * rendered via dangerouslySetInnerHTML. The API already runs sanitize-html
 * at write time (see apps/api/src/core/utils/rich-text-sanitizer.ts), but
 * rendering raw HTML from any external source deserves a second pass: it
 * catches legacy unsanitized rows and any future backend-sanitizer regression
 * before they reach the DOM. Mirrors the backend allowlist so legit content
 * is preserved unchanged.
 */
export function sanitizeProductHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
