import { banner, cls, esc, page } from '../render.js';
import type { Account, Member } from '../data.js';

/** Account detail. One guarded write and one irreversible write, because the
 * policy engine needs both to classify. */
export function accountPage(m: Member, a: Account, fieldError?: string): string {
  const err = fieldError === undefined ? '' : banner(fieldError);
  return page(
    `Account ${a.id}`,
    `${err}
<table class="${cls('acctDetail')}" border="0" cellpadding="2">
<tr><td class="${cls('lbl')}">Member Name</td><td class="${cls('val')}">${esc(m.name)}</td></tr>
<tr><td class="${cls('lbl')}">Account Type</td><td class="${cls('val')}">${esc(a.kind)}</td></tr>
<tr><td class="${cls('lbl')}">Current Balance</td><td class="${cls('val')}">${esc(a.balance)}</td></tr>
<tr><td class="${cls('lbl')}">Hold Status</td><td class="${cls('val')}">${a.hold ? 'Hold placed' : 'None'}</td></tr>
</table>
<table class="${cls('acctActions')}" border="0" cellpadding="2"><tr>
<td class="${cls('actCell')}">
<form method="post" action="/member/${esc(m.id)}/account/${esc(a.id)}/hold">
<table border="0" cellpadding="1"><tr><td class="${cls('lbl')}">Hold Reason</td>
<td class="${cls('fld')}"><input type="text" name="reason" size="18"></td>
<td class="${cls('fld')}"><input type="submit" value="Place Hold"></td></tr></table>
</form>
</td>
<td class="${cls('actCell')}">
<form method="post" action="/member/${esc(m.id)}/account/${esc(a.id)}/transfer">
<input type="submit" value="Transfer Funds">
</form>
</td>
</tr></table>`,
  );
}

export function holdConfirmedPage(m: Member, a: Account): string {
  return page(
    'Hold Placed',
    `${banner('Hold placed on this account.')}
<table class="${cls('confirmTbl')}" border="0" cellpadding="2">
<tr><td class="${cls('lbl')}">Member Name</td><td class="${cls('val')}">${esc(m.name)}</td></tr>
<tr><td class="${cls('lbl')}">Account Number</td><td class="${cls('val')}">${esc(a.id)}</td></tr>
</table>
<p><a href="/member/${esc(m.id)}/account/${esc(a.id)}">Back to Account</a></p>`,
  );
}
