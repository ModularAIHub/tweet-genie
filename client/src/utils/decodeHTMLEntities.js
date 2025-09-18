// Utility to decode HTML entities (e.g., &quot; &amp; etc)
export function decodeHTMLEntities(text) {
  if (!text) return '';
  const txt = document.createElement('textarea');
  txt.innerHTML = text;
  return txt.value;
}
