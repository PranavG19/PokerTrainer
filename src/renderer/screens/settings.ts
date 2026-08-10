/**
 * SETTINGS AND PRIVACY — story 45 ("a plain statement of exactly what leaves my
 * machine, and an off switch") and story 44 ("without an API key the whole app
 * works, with the tutor replaced by fixed text").
 *
 * Everything factual about egress is read from main's resolved tutor. The one
 * thing this screen must never do is restate the allowlist as renderer copy: a
 * hardcoded host would keep saying "one host" after the code stopped contacting
 * one, and a privacy statement that can drift from behaviour is worse than none.
 * So the host list is rendered from `status.egressAllowlist`, and the live/off
 * wording is derived from `credentialsConfigured` and `tutorEnabled`.
 */

/**
 * A local mirror of main's `settings:read` reply. Deliberately declared here
 * rather than imported from src/main: the renderer must not pull a module that
 * imports electron or node:fs, and the IPC boundary is a serialisation boundary
 * anyway — this type is the contract, not a re-export of one.
 */
export interface GuardFailureView {
  readonly requestKind: string;
  readonly attempt: number;
  readonly violations: readonly { readonly check: string; readonly detail: string }[];
}

export interface SettingsStatus {
  readonly tutorEnabled: boolean;
  readonly tutorId: string;
  readonly credentialsConfigured: boolean;
  readonly egressAllowlist: readonly string[];
  readonly guardFailures: readonly GuardFailureView[];
  readonly profile: {
    readonly path: string;
    readonly backupCount: number;
    readonly lastRecovery: string;
  };
  readonly deleteConfirmPhrase: string;
}

export interface SettingsHandlers {
  onSetTutorEnabled: (enabled: boolean) => void;
  onDeleteProfile: (confirmation: string) => void;
  onSpokenVerdictsChange: (on: boolean) => void;
}

/** T4's diagnostics show "the last few", not the whole history. */
const GUARD_FAILURES_SHOWN = 5;

/** The Security section's "what is sent, per call", one line per item. */
const SENT_PER_CALL: readonly string[] = [
  'The hand in front of you right now: your hole cards, the board, the action so far, every stack, and the pot.',
  'What you committed to and how sure you said you were.',
  'The reason you typed, in your words.',
  'The numbers this app computed for that one decision.',
  'Entries from your own lexicon, when the answer quotes one.',
];

const NEVER_SENT: readonly string[] = [
  'Your decision log. Not a summary of it, not a sample of it.',
  'Your session history.',
  'Your profile file.',
  'Your credentials — they are never put in a prompt.',
  'Anything at all while a drill or an assessment is running.',
];

export function renderSettings(opts: {
  status: SettingsStatus;
  /**
   * Narration lives in the session rather than in SettingsStatus: it is a learner preference with no
   * egress and nothing for main to resolve, so folding it into the resolved-tutor report would blur
   * the one thing that report exists to state exactly.
   */
  spokenVerdicts: boolean;
  handlers: SettingsHandlers;
}): HTMLElement {
  const { status, handlers } = opts;

  const root = document.createElement('div');
  root.className = 'settings-screen';
  root.dataset.testid = 'settings-screen';
  root.dataset.tutorLive = String(isLive(status));
  root.dataset.tutorEnabled = String(status.tutorEnabled);
  root.dataset.credentialsConfigured = String(status.credentialsConfigured);

  root.appendChild(renderTutorState(status, handlers));
  root.appendChild(renderEgress(status));
  root.appendChild(section('What is sent, every time the tutor answers', renderSent(status)));
  root.appendChild(section('What is never sent', renderNeverSent()));
  root.appendChild(renderDiagnostics(status));
  root.appendChild(renderNarration(opts.spokenVerdicts, handlers));
  root.appendChild(renderProfileSection(status, handlers));

  return root;
}

/**
 * Live means a call could actually happen: credentials configured AND the switch
 * on. Either one missing is the fully-local case, which is why the empty
 * allowlist below is the same in both.
 */
function isLive(status: SettingsStatus): boolean {
  return status.credentialsConfigured && status.tutorEnabled;
}

function section(label: string, body: HTMLElement): HTMLElement {
  const el = document.createElement('section');
  el.className = 'settings-section';

  const heading = document.createElement('div');
  heading.className = 'stat-label';
  heading.textContent = label;
  el.appendChild(heading);
  el.appendChild(body);

  return el;
}

function paragraph(text: string, testid?: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'settings-copy';
  if (testid !== undefined) p.dataset.testid = testid;
  p.textContent = text;
  return p;
}

function list(items: readonly string[], testid: string, itemTestid: string): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'settings-list';
  ul.dataset.testid = testid;
  for (const item of items) {
    const li = document.createElement('li');
    li.dataset.testid = itemTestid;
    li.textContent = item;
    ul.appendChild(li);
  }
  return ul;
}

/** 1 of 6 — whether the tutor is live, and 4 of 6 — the off switch. */
function renderTutorState(status: SettingsStatus, handlers: SettingsHandlers): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block';

  const state = document.createElement('div');
  state.className = 'settings-state';
  state.dataset.testid = 'tutor-state';
  state.dataset.live = String(isLive(status));
  state.textContent = isLive(status) ? 'The tutor is live' : 'The tutor is off';
  body.appendChild(state);

  body.appendChild(paragraph(tutorExplanation(status), 'tutor-state-detail'));

  // Story 44: the app is whole either way, and the screen has to say so, or "off"
  // reads as "degraded".
  body.appendChild(
    paragraph(
      'Every screen, every hand and every correction works either way. With the tutor off the coaching text comes from a fixed set of written answers instead of a model.',
      'tutor-fallback-note',
    ),
  );

  body.appendChild(renderSwitch(status, handlers));

  return section('The tutor', body);
}

function tutorExplanation(status: SettingsStatus): string {
  if (!status.credentialsConfigured) {
    return 'No credentials are configured on this machine, so there is nothing to send anything with. The app is running fully locally.';
  }
  if (!status.tutorEnabled) {
    return 'Credentials are configured, but you have turned the tutor off. Nothing leaves this machine.';
  }
  return 'Credentials are configured and the tutor is on, so a tutor answer sends one request to the host listed below.';
}

function renderSwitch(status: SettingsStatus, handlers: SettingsHandlers): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-switch';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'settings-toggle';
  button.dataset.testid = 'tutor-toggle';
  button.dataset.enabled = String(status.tutorEnabled);
  button.textContent = status.tutorEnabled ? 'Turn the tutor off' : 'Turn the tutor on';
  button.addEventListener('click', () => handlers.onSetTutorEnabled(!status.tutorEnabled));
  wrap.appendChild(button);

  const note = document.createElement('span');
  note.className = 'settings-note';
  note.dataset.testid = 'tutor-toggle-note';
  note.textContent = status.tutorEnabled
    ? 'Off makes this app fully local: no host is contacted, ever.'
    : 'Off. This app is fully local.';
  wrap.appendChild(note);

  return wrap;
}

/**
 * Spoken verdicts. Off on a fresh install and after any save that does not mention it, because
 * unrequested audio out of a poker app is a hostile default — and because the verdict is fully
 * readable without it, so sound is never the only channel carrying information.
 *
 * No egress: /usr/bin/say is a local binary. It sits below the tutor sections deliberately, so
 * nothing here can be mistaken for part of the egress statement above it.
 */
function renderNarration(spokenVerdicts: boolean, handlers: SettingsHandlers): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block';

  const wrap = document.createElement('div');
  wrap.className = 'settings-switch';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'settings-toggle';
  button.dataset.testid = 'speak-verdicts-toggle';
  // `data-on` and a bare On/Off label, which is the contract tests/e2e/voice.spec.ts already asserts.
  // Deliberately NOT the tutor switch's `data-enabled` + verb-phrase idiom: that button describes the
  // action it performs ("Turn the tutor off"), which reads as the CURRENT state on a control whose
  // state the label is also carrying. Here the label states the state and the note explains it.
  button.dataset.on = String(spokenVerdicts);
  button.textContent = spokenVerdicts ? 'On' : 'Off';
  button.addEventListener('click', () => handlers.onSpokenVerdictsChange(!spokenVerdicts));
  wrap.appendChild(button);

  const note = document.createElement('span');
  note.className = 'settings-note';
  note.dataset.testid = 'speak-verdicts-note';
  note.textContent = spokenVerdicts
    ? 'On. Read through the built-in macOS voice, on this machine — nothing is sent anywhere. The same words stay on screen.'
    : 'Off. Verdicts are shown, never spoken.';
  wrap.appendChild(note);

  body.appendChild(wrap);
  return section('Reading verdicts aloud', body);
}

/** 1 of 6, second half — the exact allowlist, read from main, never restated. */
function renderEgress(status: SettingsStatus): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block';

  const hosts = document.createElement('ul');
  hosts.className = 'settings-hosts';
  hosts.dataset.testid = 'egress-allowlist';
  hosts.dataset.count = String(status.egressAllowlist.length);

  if (status.egressAllowlist.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'settings-hosts-empty';
    empty.dataset.testid = 'egress-empty';
    empty.textContent = 'Empty. No host is allowed, so no request can be made.';
    hosts.appendChild(empty);
  } else {
    for (const host of status.egressAllowlist) {
      const li = document.createElement('li');
      li.className = 'settings-host';
      li.dataset.testid = 'egress-host';
      li.textContent = host;
      hosts.appendChild(li);
    }
  }

  body.appendChild(hosts);
  body.appendChild(
    paragraph(
      'This is the complete list of hosts this app may contact. A request to anything else is a bug, and the test suite fails on one.',
      'egress-detail',
    ),
  );

  return section('Where anything goes', body);
}

/** 2 of 6 — what is sent, bounded to one node. */
function renderSent(status: SettingsStatus): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block';

  if (!isLive(status)) {
    body.appendChild(
      paragraph(
        'Nothing is being sent right now. If you turn the tutor on, one tutor answer would send exactly this and nothing else:',
        'sent-preamble',
      ),
    );
  }

  body.appendChild(list(SENT_PER_CALL, 'sent-list', 'sent-item'));
  body.appendChild(
    paragraph(
      'One decision per request. Never two, never a batch, never a history.',
      'sent-bound',
    ),
  );

  return body;
}

/** 3 of 6 — what is never sent. */
function renderNeverSent(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block';
  body.appendChild(list(NEVER_SENT, 'never-sent-list', 'never-sent-item'));
  return body;
}

/** 5 of 6 — T4: "Guard failures are logged and visible in settings." */
function renderDiagnostics(status: SettingsStatus): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block';

  const count = document.createElement('div');
  count.className = 'settings-count';
  count.dataset.testid = 'guard-failure-count';
  count.dataset.count = String(status.guardFailures.length);
  count.textContent = String(status.guardFailures.length);
  body.appendChild(count);

  body.appendChild(
    paragraph(
      'Every tutor answer is checked before you see it. A failed check is thrown away and replaced with written text — these are the ones that failed.',
      'guard-detail',
    ),
  );

  if (status.guardFailures.length === 0) {
    body.appendChild(paragraph('No checks have failed.', 'guard-empty'));
    return section('Answers rejected by the checks', body);
  }

  const failures = document.createElement('ol');
  failures.className = 'settings-failures';
  failures.dataset.testid = 'guard-failure-list';

  // Newest first, because the last few are the ones worth reading.
  for (const failure of [...status.guardFailures].reverse().slice(0, GUARD_FAILURES_SHOWN)) {
    failures.appendChild(renderGuardFailure(failure));
  }
  body.appendChild(failures);

  return section('Answers rejected by the checks', body);
}

function renderGuardFailure(failure: GuardFailureView): HTMLElement {
  const item = document.createElement('li');
  item.className = 'settings-failure';
  item.dataset.testid = 'guard-failure';
  item.dataset.requestKind = failure.requestKind;
  item.dataset.attempt = String(failure.attempt);

  const head = document.createElement('span');
  head.className = 'settings-failure-head';
  head.textContent = `${failure.requestKind} answer, attempt ${failure.attempt}`;
  item.appendChild(head);

  const why = document.createElement('span');
  why.className = 'settings-failure-why';
  why.dataset.testid = 'guard-failure-why';
  // What failed, in the guard's own words: the check name plus its detail.
  why.textContent = failure.violations.map((v) => `${v.check} — ${v.detail}`).join('; ');
  item.appendChild(why);

  return item;
}

/** 6 of 6 — reversibility, and the single human-gated hard delete. */
function renderProfileSection(status: SettingsStatus, handlers: SettingsHandlers): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block';

  body.appendChild(
    paragraph(
      'Your profile is written one file at a time, completely or not at all, so a crash part-way through a save cannot damage it.',
      'profile-atomic-note',
    ),
  );

  const backups = document.createElement('div');
  backups.className = 'settings-note';
  backups.dataset.testid = 'backup-count';
  backups.dataset.count = String(status.profile.backupCount);
  backups.textContent = backupLine(status.profile.backupCount);
  body.appendChild(backups);

  if (status.profile.lastRecovery.startsWith('backup')) {
    body.appendChild(
      paragraph(
        'The profile could not be read at the last start, so a backup was restored. Nothing was silently reset.',
        'recovery-notice',
      ),
    );
  }

  // The Lifecycle section, stated plainly: this is what a reset is NOT.
  body.appendChild(
    paragraph(
      'Resetting a concept is not a delete and asks nothing of you: it clears a score this app worked out, and that score is worked out again from your decisions.',
      'reset-not-a-delete',
    ),
  );

  body.appendChild(renderDelete(status, handlers));

  return section('Your data', body);
}

function backupLine(count: number): string {
  if (count === 0) return 'No backup copies yet — one is kept from each save, up to three.';
  return `${count} backup cop${count === 1 ? 'y' : 'ies'} kept, of the last three versions.`;
}

/**
 * The one hard delete. Human-gated: the button stays disabled until the exact
 * phrase is typed, and main refuses the call regardless of what this screen
 * sends — the gate is not implemented here.
 */
function renderDelete(status: SettingsStatus, handlers: SettingsHandlers): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-danger';
  wrap.dataset.testid = 'delete-profile';

  const warning = document.createElement('div');
  warning.className = 'settings-copy';
  warning.dataset.testid = 'delete-warning';
  warning.textContent =
    'Deleting your profile destroys your decision log and every backup of it. That log is the only thing here that cannot be rebuilt, and this is the only action in the app that cannot be undone.';
  wrap.appendChild(warning);

  const label = document.createElement('label');
  label.className = 'settings-confirm-label';
  label.textContent = `Type ${status.deleteConfirmPhrase} to confirm`;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'settings-confirm-input';
  input.dataset.testid = 'delete-confirm-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  label.appendChild(input);
  wrap.appendChild(label);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'settings-delete-button';
  button.dataset.testid = 'delete-confirm-button';
  button.textContent = 'Delete my profile';
  button.disabled = true;
  wrap.appendChild(button);

  input.addEventListener('input', () => {
    button.disabled = input.value !== status.deleteConfirmPhrase;
  });
  button.addEventListener('click', () => handlers.onDeleteProfile(input.value));

  return wrap;
}
