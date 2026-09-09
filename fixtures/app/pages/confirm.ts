import { cls, esc, page } from '../render.js';

/** The one-off interstitial. Replay clears it with a recovery, which is why it
 * must be benign and must not repeat. */
export function confirmPage(next: string): string {
  return page(
    'Notice',
    `<table class="${cls('noticeTbl')}" border="1" cellpadding="4"><tr><td class="${cls('noticeCell')}">
<b>System Notice</b><br>Scheduled maintenance starts at 11:00 PM. No action is needed.
</td></tr></table>
<form method="get" action="${esc(next)}">
<input type="submit" value="Continue">
</form>`,
  );
}

export function errorPage(): string {
  return page(
    'Error',
    `<table class="${cls('errTbl')}" border="1" cellpadding="4"><tr><td class="${cls('errCell')}">
<b>An unexpected error occurred.</b><br>Reference 0x5F2. Contact the service desk.
</td></tr></table>`,
  );
}
