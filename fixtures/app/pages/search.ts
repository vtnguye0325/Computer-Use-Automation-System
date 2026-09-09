import { banner, cls, page, unlabelledField } from '../render.js';

/** A frameset, because a legacy back office is a frameset. This is what forces
 * `framePath` through the whole perception layer. */
export function searchFrameset(): string {
  return `<!doctype html>
<html><head><title>Member Search</title></head>
<frameset cols="180,*">
  <frame name="nav" src="/frame/nav">
  <frame name="main" src="/frame/search">
</frameset>
</html>`;
}

export function navFrame(): string {
  return page(
    'Navigation',
    `<table class="${cls('nav')}" border="0" cellpadding="2">
<tr><td class="${cls('navCell')}"><a href="/frame/search" target="main">Member Search</a></td></tr>
<tr><td class="${cls('navCell')}"><a href="/" target="_top">Sign Out</a></td></tr>
</table>`,
  );
}

/** The search form inside the main frame. The member number field has no label
 * association at all, so only `labelAnchor` geometry can find it. */
export function searchFrame(message?: string): string {
  const note = message === undefined ? '' : banner(message);
  return page(
    'Member Search',
    `${note}
<form method="post" action="/frame/search">
<table class="${cls('searchTbl')}" border="0" cellpadding="2">
${unlabelledField('Member Number', 'q')}
<tr><td class="${cls('lbl')}"></td><td class="${cls('fld')}"><input type="submit" value="Search"></td></tr>
</table>
</form>`,
  );
}
