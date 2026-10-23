// Every value that reaches a partner page goes through esc(): business names, contact names and anything else a
// person typed are text, never markup.
const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value: unknown) { return String(value ?? '').replace(/[&<>"']/g, ch => map[ch]); }
