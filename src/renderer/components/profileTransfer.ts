/**
 * Settings → Your data: export the profile to a file, or replace it with one.
 *
 * Main does everything that touches a file (main/profileFile.ts): it opens the dialog, reads or writes, and
 * checks an import strictly. This screen sends no path and receives a file name at most. An import is shown
 * before it happens: the confirm sheet sets the file's profile beside the current one, says the current one
 * is copied aside first, and defaults to Cancel. Only "Replace my profile" sends the confirm, naming the
 * preview it showed; the app then reloads onto the imported profile.
 */

import { IMPORT_REFUSAL_TEXT, type ImportPreview, type ImportRefusal } from '../../core/profileTransfer.js';

export interface TransferBridge {
  profileExport?: () => Promise<unknown>;
  profileImportPick?: () => Promise<unknown>;
  profileImportConfirm?: (id: string, accept: boolean) => Promise<unknown>;
}

export interface TransferOptions {
  readonly bridge: TransferBridge;
  /** The profile in memory now, for the confirm's comparison. */
  readonly current: { readonly hands: number; readonly bankroll: number };
  /** Called just before the confirm is sent, so the caller stops saving the profile being replaced. */
  readonly onReplacing: () => void;
  /** Called once main has written the import (or refused it): true = reload onto it. */
  readonly onReplaced: (replaced: boolean) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function pill(label: string, testid: string, kind: '' | 'primary' | 'quiet' = ''): HTMLButtonElement {
  const b = el('button', `pill sm${kind ? ` ${kind}` : ''}`, label);
  b.type = 'button';
  b.dataset.testid = testid;
  return b;
}

const chips = (n: number): string => Math.round(n).toLocaleString('en-US');

function when(ms: number | null): string {
  if (ms === null) return 'no dated hands';
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function handsLine(n: number): string {
  return `${n} hand${n === 1 ? '' : 's'} in the log`;
}

const PICK_FAILED: Record<ImportRefusal | 'unreadable', string> = {
  ...IMPORT_REFUSAL_TEXT,
  unreadable: 'That file could not be read. Nothing was changed.',
};

const CONFIRM_FAILED: Record<string, string> = {
  stale: 'That preview has expired. Choose the file again. Nothing was changed.',
  'read-only': 'This profile is read-only right now, so it was not replaced. Nothing was changed.',
  backup: 'The current profile could not be copied aside, so it was not replaced. Nothing was changed.',
  'pre-migration-copy': 'The current profile could not be copied aside, so it was not replaced. Nothing was changed.',
  write: 'The import could not be written. Your profile is as it was.',
};

export function renderProfileTransfer(opts: TransferOptions): HTMLElement {
  const wrap = el('div', 'settings-block profile-transfer');
  wrap.dataset.testid = 'profile-transfer';

  const rows = el('div', 'settings-block g-group settings-rows');
  const exportRow = el('div', 'settings-switch');
  const exportNote = el('span', 'settings-note', 'Save a copy of your profile to a file you choose. Your licence key is not in it.');
  const exportBtn = pill('Export…', 'profile-export');
  exportRow.append(exportBtn, exportNote);
  const importRow = el('div', 'settings-switch');
  const importNote = el('span', 'settings-note', 'Replace this profile with one from a file. You see it first, and this one is kept.');
  const importBtn = pill('Import…', 'profile-import');
  importRow.append(importBtn, importNote);
  rows.append(exportRow, importRow);

  const status = el('p', 'settings-copy profile-transfer-status');
  status.dataset.testid = 'profile-transfer-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  const say = (text: string, state: string): void => {
    status.textContent = text;
    status.dataset.state = state;
    status.hidden = false;
  };

  const busy = (on: boolean): void => {
    exportBtn.disabled = on;
    importBtn.disabled = on;
  };

  exportBtn.addEventListener('click', async () => {
    if (opts.bridge.profileExport === undefined) return;
    busy(true);
    const r = (await opts.bridge.profileExport().catch(() => ({ saved: false, failed: 'write' }))) as Record<string, unknown>;
    busy(false);
    if (r.saved === true) {
      const n = Number(r.hands) || 0;
      say(`Exported your profile, ${n} hand${n === 1 ? '' : 's'}, to ${String(r.fileName)}.`, 'exported');
    }
    else if (r.canceled === true) status.hidden = true;
    else if (r.failed === 'app-folder') say('Choose a folder outside Offsuit’s own. Nothing was written.', 'failed');
    else say('The export could not be written. Nothing was saved.', 'failed');
  });

  importBtn.addEventListener('click', async () => {
    if (opts.bridge.profileImportPick === undefined) return;
    busy(true);
    const r = (await opts.bridge.profileImportPick().catch(() => ({ ok: false, reason: 'unreadable' }))) as Record<string, unknown>;
    busy(false);
    if (r.ok === true) {
      status.hidden = true;
      openImportConfirm(opts, String(r.id), String(r.fileName), r.preview as ImportPreview, say);
    } else if (r.canceled === true) {
      status.hidden = true;
    } else {
      const reason = (typeof r.reason === 'string' && r.reason in PICK_FAILED ? r.reason : 'unreadable') as keyof typeof PICK_FAILED;
      say(PICK_FAILED[reason], 'refused');
      status.dataset.reason = reason;
    }
  });

  wrap.append(rows, status);
  return wrap;
}

function openImportConfirm(
  opts: TransferOptions,
  id: string,
  fileName: string,
  preview: ImportPreview,
  say: (text: string, state: string) => void,
): void {
  document.querySelector('dialog[data-testid="import-confirm"]')?.remove();
  const dialog = el('dialog', 'pro-sheet transfer-sheet');
  dialog.dataset.testid = 'import-confirm';
  dialog.setAttribute('aria-label', 'Replace your profile');
  let answered = false;
  const answer = async (accept: boolean): Promise<void> => {
    if (answered) return;
    answered = true;
    if (accept) opts.onReplacing();
    const r = (await opts.bridge.profileImportConfirm?.(id, accept).catch(() => ({ replaced: false, reason: 'write' }))) as
      | Record<string, unknown>
      | undefined;
    if (!accept) return;
    if (r?.replaced === true) {
      say('Imported. Opening the imported profile…', 'imported');
      opts.onReplaced(true);
    } else {
      const reason = typeof r?.reason === 'string' && r.reason in CONFIRM_FAILED ? r.reason : 'write';
      say(CONFIRM_FAILED[reason], 'failed');
      opts.onReplaced(false);
    }
  };
  dialog.addEventListener('close', () => {
    dialog.remove();
    void answer(false);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  const body = el('div', 'pro-sheet-body');
  body.appendChild(el('h2', 'pro-sheet-title', 'Replace your profile?'));
  const intro = el('p', 'g-sub', `From ${fileName}${preview.exportedAt ? `, exported ${when(Date.parse(preview.exportedAt))}` : ''}.`);
  intro.dataset.testid = 'import-source';
  body.appendChild(intro);

  const compare = el('div', 'transfer-compare g-sect g-flat');
  compare.dataset.testid = 'import-compare';
  const side = (label: string, lines: string[], testid: string): HTMLElement => {
    const col = el('div', 'transfer-side');
    col.dataset.testid = testid;
    col.appendChild(el('span', 'g-label', label));
    for (const line of lines) col.appendChild(el('span', 'g-sub g-num', line));
    return col;
  };
  compare.append(
    side('This file', [handsLine(preview.hands), `${chips(preview.bankroll)} chips`, `last hand ${when(preview.lastPlayedAt)}`], 'import-file-side'),
    side('Your profile now', [handsLine(opts.current.hands), `${chips(opts.current.bankroll)} chips`], 'import-current-side'),
  );
  body.appendChild(compare);

  const keep = el('p', 'g-caption', 'Your current profile is copied aside first, next to the profile file, so this can be undone. The file’s hands become your hand log; hands imported into the Pro tools stay in their own store, untouched.');
  keep.dataset.testid = 'import-keep-note';
  body.appendChild(keep);
  if (preview.unknownKeys.length > 0) {
    const n = preview.unknownKeys.length;
    const carried = el('p', 'g-caption', `${n} field${n === 1 ? '' : 's'} from a newer Offsuit ${n === 1 ? 'is' : 'are'} kept as ${n === 1 ? 'it is' : 'they are'}, unread.`);
    carried.dataset.testid = 'import-unknown';
    body.appendChild(carried);
  }

  const foot = el('div', 'pro-sheet-foot');
  const cancel = pill('Cancel', 'import-cancel', 'quiet');
  cancel.addEventListener('click', () => dialog.close());
  const replace = pill('Replace my profile', 'import-replace', 'primary');
  replace.addEventListener('click', () => {
    replace.disabled = true;
    cancel.disabled = true;
    void answer(true).then(() => dialog.close());
  });
  foot.append(cancel, replace);

  dialog.append(body, foot);
  document.body.appendChild(dialog);
  dialog.showModal();
  // The safe choice has focus: Enter on an unread sheet cancels.
  cancel.focus();
}
