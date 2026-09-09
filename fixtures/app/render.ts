/**
 * HTML helpers that emit the legacy shape on purpose: nested tables for layout,
 * no test IDs, no stable ids, and class names rehashed on every process boot.
 * A selector-based recorder breaks between runs against this markup. The
 * accessibility ladder does not, which is the claim the whole project makes.
 */
import { randomBytes } from 'node:crypto';

const BOOT_SALT = randomBytes(3).toString('hex');
const hashed = new Map<string, string>();

/** Same logical name gives the same class inside one boot, a new one after a restart. */
export function cls(logical: string): string {
  const existing = hashed.get(logical);
  if (existing !== undefined) return existing;
  let h = 0;
  for (const ch of `${logical}:${BOOT_SALT}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const name = `c-${h.toString(16).slice(0, 4)}`;
  hashed.set(logical, name);
  return name;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A full document. The chrome is a nested table, never CSS layout. */
export function page(title: string, body: string): string {
  return `<!doctype html>
<html><head><title>${esc(title)}</title></head>
<body>
<table class="${cls('shell')}" border="1" cellpadding="4" cellspacing="0" width="100%">
<tr><td class="${cls('shellHead')}"><b>Meridian Credit Union &mdash; Back Office</b></td></tr>
<tr><td class="${cls('shellBody')}">
<table class="${cls('inner')}" border="0" cellpadding="3" cellspacing="0">
<tr><td class="${cls('innerCell')}">
${body}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

/**
 * A label in one cell and its input in the next, with no `for` attribute and no
 * `aria-label`. This is what forces the `labelAnchor` strategy to carry weight.
 */
export function unlabelledField(label: string, name: string, value = ''): string {
  return `<tr><td class="${cls('lbl')}">${esc(label)}</td>` +
    `<td class="${cls('fld')}"><input type="text" name="${esc(name)}" value="${esc(value)}" size="20"></td></tr>`;
}

export function banner(text: string): string {
  return `<table class="${cls('banner')}" border="1" cellpadding="4"><tr><td class="${cls('bannerCell')}"><b>${esc(text)}</b></td></tr></table>`;
}
