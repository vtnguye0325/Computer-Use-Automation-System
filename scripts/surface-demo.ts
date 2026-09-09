/**
 * A hand demo of the surface seam: sign in, search, and print what the system
 * perceives. It exists so a reviewer can watch the ladder drive a real window,
 * which the headless tests prove but do not show.
 */
import { createPlaywrightSurface } from '../src/surface/playwright.js';
import { config } from '../src/config.js';
import type { Action, AriaRole, TargetDescriptor } from '../src/surface/types.js';
import type { PlaywrightSurface } from '../src/surface/playwright.js';

/** A silently swallowed act result turns a dead app into an empty observation. */
async function act(surface: PlaywrightSurface, action: Action): Promise<void> {
  const result = await surface.act(action);
  if (result.status === 'error') {
    throw new Error(`${action.type} failed: ${result.reason}`);
  }
}

const field = (label: string): TargetDescriptor => ({
  description: `${label} field`,
  strategies: [{ kind: 'labelAnchor', anchorText: label, direction: 'right', role: 'textbox' }],
});

const button = (name: string): TargetDescriptor => ({
  description: `${name} button`,
  strategies: [{ kind: 'roleName', role: 'button', name, exact: true }],
});

const surface = await createPlaywrightSurface({
  headed: true,
  onEvent: (event) => console.log(JSON.stringify(event)),
});

try {
  await act(surface, { type: 'navigate', url: `${config.targetUrl}/` });
  await act(surface, { type: 'type', target: field('User Name'), text: 'teller' });
  await act(surface, { type: 'type', target: field('Password'), text: 'demo' });
  await act(surface, { type: 'click', target: button('Sign In') });
  await act(surface, { type: 'type', target: field('Member Number'), text: '100001' });
  await act(surface, { type: 'click', target: button('Search') });

  const observation = await surface.observe();
  console.log(`\n${observation.url}  ${observation.elements.length} elements`);
  for (const e of observation.elements) {
    const role = e.role as AriaRole;
    const frame = e.framePath.length === 0 ? '-' : e.framePath.join('/');
    console.log(`[${e.ref}] ${frame} ${role} "${e.name}"${e.value === undefined ? '' : ` value="${e.value}"`}`);
  }
} finally {
  await surface.close();
}
