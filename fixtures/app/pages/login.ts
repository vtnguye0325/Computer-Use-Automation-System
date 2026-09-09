import { banner, cls, esc, page, unlabelledField } from '../render.js';

/** The sign-in screen. The submit control carries a real accessible name, so the
 * `roleName` strategy is proved on at least one control. */
export function loginPage(message?: string): string {
  const note = message === undefined ? '' : banner(message);
  return page(
    'Sign In',
    `${note}
<form method="post" action="/">
<table class="${cls('loginTbl')}" border="0" cellpadding="2">
${unlabelledField('User Name', 'user')}
<tr><td class="${cls('lbl')}">Password</td><td class="${cls('fld')}"><input type="password" name="password" size="20"></td></tr>
<tr><td class="${cls('lbl')}"></td><td class="${cls('fld')}"><input type="submit" value="Sign In"></td></tr>
</table>
</form>
<p class="${cls('hint')}">${esc('Demo only. Any user name, password: demo')}</p>`,
  );
}
