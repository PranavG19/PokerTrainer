import { keycap } from './glyphs.js';

/**
 * Settings → Dee → "Smarter phrasing (optional, about 1 GB download)". The row states what it is; "Download…"
 * opens a consent sheet that shows each component's licence BEFORE anything is fetched, and the download starts
 * only from that sheet's button, with the box ticked. Progress, cancel, the on/off switch and Delete all live in
 * the row. The renderer never fetches anything: main does, and refuses without the consent flag and the licence
 * ids the sheet showed.
 */

export interface PhrasingView {
  readonly state: 'unavailable' | 'absent' | 'downloading' | 'installed' | 'error';
  readonly enabled: boolean;
  readonly received: number;
  readonly total: number;
  readonly error: string | null;
  readonly sizeBytes: number;
  readonly name: string;
  readonly running: boolean;
  readonly licences: readonly { component: string; spdx: string; holder: string; source: string; summary: string }[];
}

export interface PhrasingActions {
  download: (consent: boolean, licences: string) => void;
  cancel: () => void;
  remove: () => void;
  setEnabled: (on: boolean) => void;
}

export interface PhrasingRowHandle {
  readonly root: HTMLElement;
  update(view: PhrasingView): void;
}

const gb = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;
const mb = (bytes: number): string => `${Math.round(bytes / 1e6)} MB`;

export function renderPhrasingRow(initial: PhrasingView, actions: PhrasingActions): PhrasingRowHandle {
  let view = initial;
  const root = document.createElement('div');
  root.className = 'dee-phrasing';
  root.dataset.testid = 'dee-phrasing';

  const title = document.createElement('h2');
  title.className = 'g-label dee-sect-title';
  title.textContent = 'Smarter phrasing';

  const group = document.createElement('div');
  group.className = 'g-group';
  const row = document.createElement('div');
  row.className = 'g-row dee-phrasing-row';
  const textCol = document.createElement('div');
  textCol.className = 'dee-choice-body';
  const name = document.createElement('span');
  name.className = 'dee-choice-title';
  name.textContent = 'Optional, about 1 GB download';
  const caption = document.createElement('span');
  caption.className = 'g-caption';
  caption.dataset.testid = 'dee-phrasing-caption';
  const bar = document.createElement('div');
  bar.className = 'dee-phrasing-bar';
  bar.dataset.testid = 'dee-phrasing-progress';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Download progress');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const fill = document.createElement('span');
  bar.append(fill);
  textCol.append(name, caption, bar);

  const controls = document.createElement('div');
  controls.className = 'dee-phrasing-controls';
  row.append(textCol, controls);
  group.append(row);
  root.append(title, group);

  const button = (label: string, testid: string, onClick: () => void, cls = 'pill sm'): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.dataset.testid = testid;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  function paint(): void {
    root.dataset.state = view.state;
    const pct = view.total > 0 ? Math.floor((view.received / view.total) * 100) : 0;
    bar.hidden = view.state !== 'downloading';
    fill.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(pct));
    const parts: HTMLElement[] = [];
    switch (view.state) {
      case 'unavailable':
        caption.textContent = 'Not available on this computer yet. Dee uses the written answers, which are complete.';
        break;
      case 'absent':
        caption.textContent = 'A small model on this Mac rewords the answers. Numbers stay the engine’s.';
        parts.push(button('Download…', 'dee-phrasing-download', () => openConsent()));
        break;
      case 'error':
        caption.textContent = `The download stopped: ${view.error ?? 'unknown error'}. Nothing was kept.`;
        parts.push(button('Try again…', 'dee-phrasing-download', () => openConsent()));
        break;
      case 'downloading':
        caption.textContent = `Downloading and checking: ${mb(view.received)} of ${mb(view.total)} (${pct}%)`;
        parts.push(button('Cancel', 'dee-phrasing-cancel', () => actions.cancel(), 'pill quiet sm'));
        break;
      case 'installed': {
        caption.textContent = view.enabled
          ? 'On. A rewording that fails a check or runs late shows the written answer.'
          : 'Installed, off. Dee uses the written answers.';
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'g-switch';
        sw.dataset.testid = 'dee-phrasing-toggle';
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(view.enabled));
        sw.setAttribute('aria-label', 'Smarter phrasing');
        const track = document.createElement('span');
        track.className = 'g-switch-track';
        track.setAttribute('aria-hidden', 'true');
        sw.append(track);
        sw.addEventListener('click', () => actions.setEnabled(!view.enabled));
        parts.push(button('Delete', 'dee-phrasing-delete', () => actions.remove(), 'pill quiet sm'), sw);
        break;
      }
    }
    // Keep focus on the row's control across a repaint (progress ticks repaint ten times a second).
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.testid;
    controls.replaceChildren(...parts);
    if (focusedId && controls.contains(document.activeElement) === false) {
      controls.querySelector<HTMLElement>(`[data-testid="${focusedId}"]`)?.focus();
    }
  }

  function openConsent(): void {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = document.createElement('div');
    layer.className = 'dee-chat-layer';
    const scrim = document.createElement('div');
    scrim.className = 'dee-chat-scrim';
    const sheet = document.createElement('section');
    sheet.className = 'dee-consent';
    sheet.dataset.testid = 'dee-consent';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'dee-consent-title');
    const h = document.createElement('h2');
    h.id = 'dee-consent-title';
    h.className = 'dee-chat-title';
    h.textContent = 'Download smarter phrasing?';
    const what = document.createElement('p');
    what.className = 'g-sub';
    what.textContent = `${view.name}, ${gb(view.sizeBytes)}, saved on this Mac. This is the only time chat uses the network, and only after the button below. Delete removes it.`;
    const list = document.createElement('ul');
    list.className = 'g-group dee-licences';
    list.dataset.testid = 'dee-licences';
    for (const l of view.licences) {
      const li = document.createElement('li');
      li.className = 'g-row';
      li.dataset.spdx = l.spdx;
      const t = document.createElement('div');
      t.className = 'dee-choice-body';
      const n = document.createElement('span');
      n.className = 'dee-choice-title';
      n.textContent = `${l.component}: ${l.spdx}`;
      const d = document.createElement('span');
      d.className = 'g-caption';
      d.textContent = `${l.summary} ${l.holder}; ${l.source}.`;
      t.append(n, d);
      li.append(t);
      list.append(li);
    }
    const agree = document.createElement('label');
    agree.className = 'dee-consent-agree';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.testid = 'dee-consent-accept';
    agree.append(box, document.createTextNode(' I accept these licences and want to download about 1 GB.'));
    const foot = document.createElement('div');
    foot.className = 'coach-sheet-foot';
    const cancel = button('Not now', 'dee-consent-cancel', () => done(), 'pill quiet');
    const go = button('Download', 'dee-consent-download', () => {
      if (!box.checked) return;
      actions.download(true, view.licences.map((l) => l.spdx).join('+'));
      done();
    }, 'pill primary');
    go.disabled = true;
    go.append(keycap('↩'));
    box.addEventListener('change', () => {
      go.disabled = !box.checked;
    });
    foot.append(cancel, go);
    sheet.append(h, what, list, agree, foot);
    layer.append(scrim, sheet);
    scrim.addEventListener('click', () => done());
    const onKey = (e: KeyboardEvent): void => {
      e.stopPropagation();
      if (e.key === 'Escape') done();
    };
    window.addEventListener('keydown', onKey, true);
    document.body.append(layer);
    box.focus();
    function done(): void {
      window.removeEventListener('keydown', onKey, true);
      layer.remove();
      if (opener?.isConnected) opener.focus();
    }
  }

  paint();
  return {
    root,
    update(next) {
      view = next;
      paint();
    },
  };
}
