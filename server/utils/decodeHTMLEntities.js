// Utility to decode HTML entities (Node.js)
export function decodeHTMLEntities(text) {
  if (!text) return '';
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x60;/g, '`')
    .replace(/&#x2F;/g, '/')
    .replace(/&#39;/g, "'");
}
