/**
 * Settings → Offsuit Pro: status, the licence key entry, restore, manage/cancel, and the Pro tools
 * through the one gate (pro.ts proGate). Everything shown is main's snapshot; every action goes to main.
 *
 * Network, stated where it happens: verifying a key is offline. "Check for renewal" and "Restore" each
 * make one request to the licence server named next to the button, and only when pressed.
 */

import { FEATURE_INFO, PRO_FEATURES, type Feature } from '../../core/entitlements/features.js';
import { formatDay, proGate, type ProClient } from '../pro.js';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pill(label: string, testid: string, extra = ''): HTMLButtonElement {
  const b = el('button', `pill sm${extra ? ` ${extra}` : ''}`, label);
  b.type = 'button';
  b.dataset.testid = testid;
  return b;
}

/** The headline and its explanation, from the snapshot alone. */
export function statusLines(pro: ProClient): { head: string; detail: string } {
  const s = pro.status().snapshot;
  const plan = s.plan === null ? '' : `${s.plan[0].toUpperCase()}${s.plan.slice(1)} `;
  switch (s.state) {
    case 'active':
      return {
        head: s.paidThrough === null ? `${plan}Pro, for good` : `${plan}Pro, through ${formatDay(s.paidThrough)}`,
        detail: `Key ending ${s.licenceHint ?? ''}${s.seats !== null ? `, for up to ${s.seats} Macs` : ''}. Checked on this Mac, offline.`,
      };
    case 'grace':
      return {
        head: 'Pro, waiting for your renewal',
        detail: `Your paid period ended on ${formatDay(s.paidThrough ?? 0)}. Pro stays on until ${formatDay(s.graceEndsAt ?? 0)} so a renewal has time to arrive: press Check for renewal, or paste the new key.`,
      };
    case 'expired':
      return {
        head: 'Free',
        detail: `Your Pro period ended on ${formatDay(s.paidThrough ?? 0)}. Everything you learned and earned is still here.`,
      };
    case 'invalid':
      return { head: 'Free', detail: 'The key stored on this Mac could not be verified, so it grants nothing. Paste your key again, or restore it.' };
    case 'dev':
      return { head: `Developer override: ${s.tier === 'pro' ? 'Pro' : 'Free'}`, detail: 'OFFSUIT_DEV_TIER is set and this build is not packaged. A packaged build ignores it.' };
    default:
      return { head: 'Free', detail: 'Learning is never locked. Every table, drill, lesson, puzzle, chart and Dee are free, and stay free.' };
  }
}

export interface ProSettingsHandlers {
  readonly openSheet: (feature?: Feature) => void;
}

export function renderProSettings(pro: ProClient, handlers: ProSettingsHandlers): HTMLElement {
  const status = pro.status();
  const s = status.snapshot;
  const section = el('section', 'settings-section pro-settings');
  section.dataset.testid = 'pro-settings';
  section.dataset.tier = s.tier;
  section.dataset.state = s.state;
  section.appendChild(el('div', 'stat-label', 'Offsuit Pro'));

  const body = el('div', 'settings-block');
  const lines = statusLines(pro);
  const head = el('div', 'settings-state t-t3', lines.head);
  head.dataset.testid = 'pro-state';
  const detail = el('p', 'settings-copy', lines.detail);
  detail.dataset.testid = 'pro-state-detail';
  body.append(head, detail);

  if (s.tier === 'free') {
    const never = el('p', 'settings-copy', 'Pro adds online ranked play, the leak finder, ICM tools and cloud sync. It never locks anything you learn with.');
    never.dataset.testid = 'pro-free-copy';
    body.appendChild(never);
  }
  if (s.clockBehind) {
    const clock = el('p', 'settings-note', 'This Mac’s clock is behind the last time Offsuit saw. Licence time counts from that moment, not from the clock.');
    clock.dataset.testid = 'pro-clock-behind';
    body.appendChild(clock);
  }

  const notice = pro.notice();
  if (notice !== null) {
    const n = el('p', `settings-note pro-notice`, notice.text);
    n.dataset.testid = 'pro-notice';
    n.dataset.kind = notice.kind;
    n.setAttribute('role', 'status');
    body.appendChild(n);
  }

  const actions = el('div', 'pro-actions');
  if (s.tier === 'free' || s.state === 'grace') {
    const see = pill('What Pro adds', 'pro-see', s.tier === 'free' ? 'primary' : '');
    see.addEventListener('click', () => handlers.openSheet());
    actions.appendChild(see);
  }
  if (s.plan !== null && s.state !== 'invalid') {
    const manage = pill('Manage or cancel', 'pro-manage');
    manage.disabled = !status.manage;
    manage.addEventListener('click', () => void pro.openManage());
    actions.appendChild(manage);
    const renew = pill('Check for renewal', 'pro-refresh');
    renew.disabled = status.server === null;
    renew.addEventListener('click', () => void pro.refresh());
    actions.appendChild(renew);
  }
  if (actions.childElementCount > 0) body.appendChild(actions);
  if (s.plan !== null && s.state !== 'invalid') {
    body.appendChild(
      el(
        'p',
        'settings-note',
        status.server === null
          ? 'Check for renewal needs the licence server, which this build does not have yet. Pasting a new key always works.'
          : `Check for renewal sends your key to ${status.server} once, when you press it. Nothing is sent otherwise.`,
      ),
    );
  }

  body.appendChild(renderKeyEntry(pro));
  body.appendChild(renderRestore(pro));

  const tools = el('div', 'pro-tools g-group');
  tools.dataset.testid = 'pro-tools';
  for (const f of PRO_FEATURES) tools.appendChild(proGate(pro, f, () => el('div', 'pro-gate', FEATURE_INFO[f].title), handlers.openSheet));
  body.appendChild(el('div', 'g-label', 'Pro tools'));
  body.appendChild(tools);

  if (s.licenceHint !== null) {
    const remove = pill('Remove the key from this Mac', 'pro-remove', 'quiet');
    remove.addEventListener('click', () => void pro.remove());
    body.appendChild(remove);
  }

  section.appendChild(body);
  return section;
}

function renderKeyEntry(pro: ProClient): HTMLElement {
  const wrap = el('div', 'pro-key');
  const label = el('label', 'g-label', 'Licence key');
  const input = el('textarea', 'pro-key-input settings-confirm-input');
  input.dataset.testid = 'pro-key-input';
  input.id = 'pro-key-input';
  input.rows = 2;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = 'OFFSUIT1.…';
  label.htmlFor = input.id;
  const activate = pill('Activate', 'pro-activate');
  activate.disabled = true;
  input.addEventListener('input', () => {
    activate.disabled = input.value.trim() === '';
  });
  activate.addEventListener('click', () => void pro.activate(input.value));
  const row = el('div', 'pro-key-row');
  row.append(input, activate);
  wrap.append(label, row, el('p', 'settings-note', 'Paste the key from your receipt or the page checkout ended on. It is checked on this Mac; nothing is sent.'));
  return wrap;
}

function renderRestore(pro: ProClient): HTMLElement {
  const status = pro.status();
  const details = el('details', 'pro-restore');
  details.dataset.testid = 'pro-restore';
  details.appendChild(el('summary', 'g-label', 'Lost your key? Restore it'));
  const order = el('input', 'settings-confirm-input');
  order.placeholder = 'Order number from your receipt';
  order.dataset.testid = 'pro-restore-order';
  order.setAttribute('aria-label', 'Order number');
  const email = el('input', 'settings-confirm-input');
  email.type = 'email';
  email.placeholder = 'Email you bought with';
  email.dataset.testid = 'pro-restore-email';
  email.setAttribute('aria-label', 'Email');
  const go = pill('Restore', 'pro-restore-go');
  go.disabled = status.server === null;
  go.addEventListener('click', () => void pro.restore(order.value, email.value));
  const row = el('div', 'pro-key-row');
  row.append(order, email, go);
  details.append(
    row,
    el(
      'p',
      'settings-note',
      status.server === null
        ? 'Restore needs the licence server, which this build does not have yet.'
        : `Restore sends the order number and email to ${status.server} once, when you press it.`,
    ),
  );
  return details;
}
