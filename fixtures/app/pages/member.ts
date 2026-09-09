import { cls, esc, page } from '../render.js';
import type { Member } from '../data.js';

/** Member detail. Sub-accounts sit in a table nested inside the layout table, so
 * "the next node in document order" is not a usable resolution rule here. */
export function memberPage(m: Member): string {
  const rows = m.accounts
    .map(
      (a) => `<tr><td class="${cls('acctCell')}">${esc(a.kind)}</td>` +
        `<td class="${cls('acctCell')}">${esc(a.id)}</td>` +
        `<td class="${cls('acctCell')}">${esc(a.balance)}</td>` +
        `<td class="${cls('acctCell')}"><a href="/member/${esc(m.id)}/account/${esc(a.id)}">View</a></td></tr>`,
    )
    .join('\n');
  return page(
    `Member ${m.id}`,
    `<table class="${cls('memberTbl')}" border="0" cellpadding="2">
<tr><td class="${cls('lbl')}">Member Number</td><td class="${cls('val')}">${esc(m.id)}</td></tr>
<tr><td class="${cls('lbl')}">Member Name</td><td class="${cls('val')}">${esc(m.name)}</td></tr>
<tr><td class="${cls('lbl')}">Status</td><td class="${cls('val')}">${esc(m.status)}</td></tr>
<tr><td class="${cls('lbl')}" valign="top">Accounts</td><td class="${cls('val')}">
<table class="${cls('acctTbl')}" border="1" cellpadding="3" cellspacing="0">
<tr><td class="${cls('acctHead')}">Type</td><td class="${cls('acctHead')}">Number</td><td class="${cls('acctHead')}">Balance</td><td class="${cls('acctHead')}">Action</td></tr>
${rows}
</table>
</td></tr></table>`,
  );
}
