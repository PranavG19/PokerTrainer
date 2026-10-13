/**
 * The upgrade sheet and the deep-link confirmation: glass sheets (the coach sheet's float material) in a
 * native modal <dialog>, so focus is held inside, Escape closes, and the page behind is inert.
 *
 * Honest by construction (DECISIONS.md "Pro and licensing"): the price is on the sheet before checkout,
 * renewal and how to cancel are stated in the same place, features that have not shipped say so, and
 * learning is named as never locked. No countdown, no "limited", no pre-ticked box, no guilt-worded
 * dismiss. "Not now" closes it and nothing asks again.
 */

import { MERCHANT_NAME, PRICE_LABELS } from '../../core/entitlements/config.js';
import { FEATURE_INFO, FREE_FEATURES, PRO_FEATURES, type Feature } from '../../core/entitlements/features.js';
import { attachThumb } from './thumb.js';
import { formatDay, type ProClient } from '../pro.js';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pill(label: string, testid: string, kind: '' | 'primary' | 'quiet' = ''): HTMLButtonElement {
  const b = el('button', `pill${kind ? ` ${kind}` : ''}`, label);
  b.type = 'button';
  b.dataset.testid = testid;
  return b;
}

function openDialog(testid: string, label: string, build: (close: () => void) => HTMLElement[]): HTMLDialogElement {
  document.querySelector(`dialog[data-testid="${testid}"]`)?.remove();
  const dialog = el('dialog', 'pro-sheet');
  dialog.dataset.testid = testid;
  dialog.setAttribute('aria-label', label);
  const close = (): void => {
    dialog.close();
  };
  dialog.addEventListener('close', () => dialog.remove());
  // A click on the backdrop (the dialog box itself, outside the content) closes it, like Escape.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  // The actions stay in view: everything but the foot scrolls, the foot is pinned under it.
  const parts = build(close);
  const foot = parts.find((p) => p.classList.contains('pro-sheet-foot'));
  const body = el('div', 'pro-sheet-body');
  body.append(...parts.filter((p) => p !== foot));
  dialog.appendChild(body);
  if (foot !== undefined) dialog.appendChild(foot);
  document.body.appendChild(dialog);
  dialog.showModal();
  return dialog;
}

export interface UpgradeSheetOptions {
  /** The feature the learner reached for, listed first and marked. */
  readonly feature?: Feature;
  /** "I have a key": take the learner to the licence entry in Settings. */
  readonly onHaveKey: () => void;
}

export function openUpgradeSheet(pro: ProClient, opts: UpgradeSheetOptions): HTMLDialogElement {
  return openDialog('upgrade-sheet', 'Offsuit Pro', (close) => {
    const status = pro.status();
    const head = el('div', 'pro-sheet-head');
    head.append(
      el('h2', 'pro-sheet-title', 'Offsuit Pro'),
      el(
        'p',
        'g-sub',
        'Pro is for playing people online and for power tools on top of what you study. Learning is never locked: every table, drill, lesson, puzzle, chart and Dee stay free, for good.',
      ),
    );

    const adds = el('section', 'pro-sheet-sect');
    adds.appendChild(el('div', 'g-label', 'What Pro adds'));
    const list = el('ul', 'pro-feature-list');
    list.dataset.testid = 'upgrade-pro-features';
    const order = opts.feature !== undefined && FEATURE_INFO[opts.feature].tier === 'pro'
      ? [opts.feature, ...PRO_FEATURES.filter((f) => f !== opts.feature)]
      : [...PRO_FEATURES];
    for (const f of order) {
      const info = FEATURE_INFO[f];
      const li = el('li', 'pro-feature');
      li.dataset.feature = f;
      if (f === opts.feature) li.dataset.focus = 'true';
      const t = el('div', 'pro-feature-title', info.title);
      if (!info.available) {
        const tag = el('span', 'pro-tag', 'Coming in an update');
        tag.dataset.testid = 'coming-tag';
        t.appendChild(tag);
      }
      li.append(t, el('div', 'g-caption', info.blurb));
      list.appendChild(li);
    }
    adds.appendChild(list);

    const free = el('section', 'pro-sheet-sect');
    free.appendChild(el('div', 'g-label', 'Always free'));
    const freeLine = el('p', 'g-caption', FREE_FEATURES.map((f) => FEATURE_INFO[f].title).join(' · '));
    freeLine.dataset.testid = 'upgrade-free-features';
    free.appendChild(freeLine);

    // Plan choice: monthly first and selected, so the smaller commitment is the default.
    let plan: 'monthly' | 'annual' = 'monthly';
    const seg = el('div', 'g-seg pro-plan');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Plan');
    seg.dataset.testid = 'upgrade-plan';
    const price = el('p', 'g-caption pro-price');
    price.dataset.testid = 'upgrade-price';
    const paint = (): void => {
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.plan === plan));
      price.textContent = PRICE_LABELS[plan] !== '' ? PRICE_LABELS[plan] : 'The price is shown at checkout, before you pay.';
      checkout.disabled = !status.checkout[plan];
      checkout.textContent = status.checkout[plan] ? 'Continue to checkout' : 'Checkout is not open yet';
    };
    for (const [id, label] of [['monthly', 'Monthly'], ['annual', 'Annual']] as const) {
      const b = el('button', '', label);
      b.type = 'button';
      b.dataset.plan = id;
      b.dataset.testid = `upgrade-plan-${id}`;
      b.addEventListener('click', () => {
        plan = id;
        paint();
      });
      seg.appendChild(b);
    }

    const terms = el(
      'p',
      'g-caption pro-terms',
      `Renews until you cancel. Cancel any time in Settings → Offsuit Pro → Manage or cancel: Pro runs to the end of the paid period, and nothing you learned or earned goes away. Checkout opens in your browser; ${MERCHANT_NAME} is the seller and handles payment, tax and refunds, so Offsuit never sees your card.`,
    );
    terms.dataset.testid = 'upgrade-terms';
    const anyComing = PRO_FEATURES.some((f) => !FEATURE_INFO[f].available);

    const foot = el('div', 'pro-sheet-foot');
    const notNow = pill('Not now', 'upgrade-not-now', 'quiet');
    notNow.addEventListener('click', close);
    const haveKey = pill('I have a key', 'upgrade-have-key');
    haveKey.addEventListener('click', () => {
      close();
      opts.onHaveKey();
    });
    const checkout = pill('Continue to checkout', 'upgrade-checkout', 'primary');
    checkout.addEventListener('click', () => {
      void pro.openCheckout(plan).then(close);
    });
    foot.append(notNow, haveKey, checkout);

    const planRow = el('div', 'pro-plan-row');
    planRow.append(seg, price);
    queueMicrotask(() => attachThumb(seg));
    paint();

    const parts: HTMLElement[] = [head, adds, free, planRow, terms];
    if (anyComing) {
      const coming = el('p', 'g-caption', 'Pro’s features arrive in updates; checkout stays closed until the first one ships.');
      coming.dataset.testid = 'upgrade-coming-note';
      parts.push(coming);
    }
    if (status.snapshot.tier === 'pro') {
      parts.splice(1, 0, el('p', 'g-sub', 'You already have Pro on this Mac.'));
    }
    parts.push(foot);
    return parts;
  });
}

/**
 * A link from a web page offered a key. Any page can open an offsuit:// link, so the key is only a
 * proposal until the learner says yes here.
 */
export async function openDeepLinkConfirm(pro: ProClient): Promise<void> {
  const preview = await pro.deepLinkPreview();
  if (preview === null) return;
  let answered = false;
  const answer = (accept: boolean): void => {
    if (answered) return;
    answered = true;
    void pro.confirmDeepLink(accept);
  };
  const dialog = openDialog('deeplink-confirm', 'Add a Pro key', (close) => {
    const head = el('h2', 'pro-sheet-title', 'Add this Pro key?');
    if ('kind' in preview) {
      const msg = el('p', 'g-sub', `A link offered a key, but it cannot be used: ${preview.text}`);
      const ok = pill('Close', 'deeplink-close', 'primary');
      ok.addEventListener('click', () => {
        answer(false);
        close();
      });
      const foot = el('div', 'pro-sheet-foot');
      foot.appendChild(ok);
      return [head, msg, foot];
    }
    const what = el(
      'p',
      'g-sub',
      `${capitalise(preview.plan)} Pro${preview.paidThrough === null ? '' : `, paid through ${formatDay(preview.paidThrough)}`}, key ending ${preview.licenceHint}.`,
    );
    what.dataset.testid = 'deeplink-summary';
    const why = el('p', 'g-caption', 'A link opened Offsuit with this key. Add it if you just bought or restored Pro; otherwise choose Not now and nothing changes.');
    const foot = el('div', 'pro-sheet-foot');
    const no = pill('Not now', 'deeplink-decline', 'quiet');
    no.addEventListener('click', () => {
      answer(false);
      close();
    });
    const yes = pill('Add key', 'deeplink-accept', 'primary');
    yes.addEventListener('click', () => {
      answer(true);
      close();
    });
    foot.append(no, yes);
    return [head, what, why, foot];
  });
  // Escape or a backdrop click is a no: the proposed key is dropped, never left pending.
  dialog.addEventListener('close', () => answer(false));
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
