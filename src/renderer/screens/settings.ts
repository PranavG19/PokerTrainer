import { attachThumb } from '../components/thumb.js';
import type { QuietLevel } from '../../core/dee/engine.js';
import type { CelebrationsState } from '../../core/progression/types.js';


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
    /** The profile format this build writes, and the format of the file as loaded (profileSchema.ts). */
    readonly schemaVersion?: number;
    readonly fileSchemaVersion?: number;
    /** Set when this load upgraded the profile from an older format. */
    readonly migratedFrom?: number | null;
    /** The untouched copy kept from before the upgrade, when there is one. */
    readonly preMigrationCopy?: string | null;
    /** Why main refuses to save, or null. */
    readonly readOnly?: ReadOnlyReason | null;
  };
  readonly deleteConfirmPhrase: string;
  /** The chosen visual theme id (graphite default). A device preference, read from the settings file. */
  readonly theme: string;
}

export interface SettingsHandlers {
  onSetTutorEnabled: (enabled: boolean) => void;
  onDeleteProfile: (confirmation: string) => void;
  onSpokenVerdictsChange: (on: boolean) => void;
  onSoundCuesChange: (on: boolean) => void;
  onThemeChange: (theme: string) => void;
  /** Open Dee's settings (personality, when Dee speaks, Character). */
  onOpenDee?: () => void;
  /** Settings › Character (1.8): the same Character switch and quieter level Dee's own screen sets. */
  onCharacterChange?: (on: boolean) => void;
  onQuietChange?: (level: QuietLevel) => void;
  /** Settings › Celebrations (1.8): the session-end moment's switches. */
  onCelebrationsChange?: (patch: Partial<CelebrationsState>) => void;
  /** Open the local trial (setup, the running weeks, or the results). */
  onOpenTrial?: () => void;
}

/** What Settings › Character, Celebrations and The trial show (1.8). Absent = the sections are not drawn. */
export interface HabitSettingsView {
  readonly character: boolean;
  readonly quiet: string;
  readonly celebrations: CelebrationsState;
  /** Off this week: an off week of the local trial hides Dee and the moment whatever the switches say. */
  readonly offWeek: boolean;
  /** One line on where the trial stands, and the button's label. */
  readonly trialLine: string;
  readonly trialAction: string;
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
  /** Same rationale as spokenVerdicts: a learner preference with no egress, kept out of the tutor report. */
  soundCues: boolean;
  handlers: SettingsHandlers;
  /** Settings → Offsuit Pro (components/proSettings.ts), built by the caller that owns the Pro client. */
  proSection?: HTMLElement;
  /** Character, Celebrations and the trial (1.8). */
  habit?: HabitSettingsView;
  /** Your data → export and import (components/profileTransfer.ts), built by the caller that owns the profile. */
  profileTransfer?: HTMLElement;
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
  root.appendChild(renderSoundCues(opts.soundCues, handlers));
  root.appendChild(renderTheme(status.theme, handlers));
  if (opts.habit !== undefined) {
    root.appendChild(renderCharacter(opts.habit, handlers));
    root.appendChild(renderCelebrations(opts.habit, opts.soundCues, handlers));
    if (handlers.onOpenTrial) root.appendChild(renderTrialEntry(opts.habit, handlers.onOpenTrial));
  } else if (handlers.onOpenDee) root.appendChild(renderDeeLink(handlers.onOpenDee));
  if (opts.proSection !== undefined) root.appendChild(opts.proSection);
  root.appendChild(renderProfileSection(status, handlers, opts.profileTransfer));

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

/** The .g-switch track: decoration only, so the button's text stays its On/Off label. */
function switchTrack(): HTMLElement {
  const track = document.createElement('span');
  track.className = 'g-switch-track';
  track.setAttribute('aria-hidden', 'true');
  return track;
}

/** Dee's own screen holds its settings; this row is the way there that does not depend on the perch (Character off hides it). */
function renderDeeLink(onOpen: () => void): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block g-group settings-rows';
  const row = document.createElement('div');
  row.className = 'settings-switch';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill sm';
  button.dataset.testid = 'open-dee-settings';
  button.textContent = 'Dee’s settings';
  button.addEventListener('click', onOpen);
  const note = document.createElement('span');
  note.className = 'settings-note';
  note.textContent = 'Personality, when Dee speaks, and the Character switch.';
  row.append(button, note);
  body.appendChild(row);
  return section('Dee', body);
}

const QUIET_OPTIONS: readonly { id: QuietLevel; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'quieter', label: 'Quieter' },
  { id: 'quietest', label: 'Quietest' },
];

const QUIET_NOTE: Record<QuietLevel, string> = {
  standard: 'Dee speaks by its own rules, and less at each certified depth.',
  quieter: 'Every line waits twice as long to come back, and at least three hands pass between lines.',
  quietest: 'Every line waits three times as long, and at least six hands pass between lines.',
};

/**
 * Character (1.8): Dee on or off, and how much quieter. The same profile fields Dee's own screen sets
 * (progression.dee.character, personality.quiet), so the two screens can never disagree. Off is an
 * accessibility choice, never something to unlock.
 */
function renderCharacter(view: HabitSettingsView, handlers: SettingsHandlers): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block g-group settings-rows';
  body.dataset.testid = 'settings-character';

  body.appendChild(
    switchRow({
      testid: 'settings-character-toggle',
      on: view.character,
      name: 'Character',
      note: view.character
        ? view.offWeek
          ? 'On, but hidden this week: it is an off week of your trial.'
          : 'On. Dee greets, perches and says its lines. Off shows a plain dealer button, same verdicts.'
        : 'Off. A plain dealer button: no eyes and no lines of its own. The coach’s verdicts stay.',
      onChange: handlers.onCharacterChange,
    }),
  );

  const quiet = QUIET_OPTIONS.some((o) => o.id === view.quiet) ? (view.quiet as QuietLevel) : 'standard';
  body.appendChild(
    segRow({
      testid: 'settings-quiet',
      label: 'How often Dee speaks',
      options: QUIET_OPTIONS,
      value: quiet,
      note: QUIET_NOTE[quiet],
      noteTestid: 'settings-quiet-note',
      onChange: handlers.onQuietChange,
    }),
  );

  if (handlers.onOpenDee) {
    const row = document.createElement('div');
    row.className = 'settings-switch';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill sm';
    button.dataset.testid = 'open-dee-settings';
    button.textContent = 'Dee’s settings';
    button.addEventListener('click', handlers.onOpenDee);
    const note = document.createElement('span');
    note.className = 'settings-note';
    note.textContent = 'Personality and when Dee speaks, with a live preview.';
    row.append(button, note);
    body.appendChild(row);
  }
  return section('Character', body);
}

const MOTION_OPTIONS: readonly { id: 'system' | 'still'; label: string }[] = [
  { id: 'system', label: 'Follow the Mac' },
  { id: 'still', label: 'Always still' },
];

/**
 * Celebrations (1.8): the session-end moment (1.10) on or off, its motion, and the milestone clack (D13). Separate
 * from Character (VISION §5). The clack is behind the app's sound switch: with that off it never plays, and the
 * row says so instead of pretending.
 */
function renderCelebrations(view: HabitSettingsView, soundCues: boolean, handlers: SettingsHandlers): HTMLElement {
  const c = view.celebrations;
  const body = document.createElement('div');
  body.className = 'settings-block g-group settings-rows';
  body.dataset.testid = 'settings-celebrations';

  body.appendChild(
    switchRow({
      testid: 'celebrations-toggle',
      on: c.on,
      name: 'Celebrations',
      note: c.on
        ? view.offWeek
          ? 'On, but paused this week: it is an off week of your trial.'
          : 'On. When a session ends, one short moment of plain facts. Never on a verdict, a pot or a win.'
        : 'Off. A session ends quietly.',
      onChange: (on) => handlers.onCelebrationsChange?.({ on }),
    }),
  );

  const motion = c.motion === 'still' ? 'still' : 'system';
  body.appendChild(
    segRow({
      testid: 'celebrations-motion',
      label: 'Celebration motion',
      options: MOTION_OPTIONS,
      value: motion,
      note: motion === 'still' ? 'Reduced motion: the words show, still.' : 'Moves unless the Mac’s Reduce motion is on.',
      noteTestid: 'celebrations-motion-note',
      onChange: (id) => handlers.onCelebrationsChange?.({ motion: id }),
      disabled: !c.on,
    }),
  );

  const sound = switchRow({
    testid: 'celebrations-sound-toggle',
    on: c.sound && soundCues,
    name: 'Milestone sound',
    note: !soundCues
      ? 'Off while “A sound on a mistake” is off: every sound is behind that one switch.'
      : c.sound
        ? 'On. One soft clack when a session ends, on this machine only.'
        : 'Off. Celebrations stay silent.',
    onChange: (on) => handlers.onCelebrationsChange?.({ sound: on }),
    disabled: !soundCues || !c.on,
  });
  sound.dataset.soundSwitch = String(soundCues);
  body.appendChild(sound);
  return section('Celebrations', body);
}

/** The local trial's entry: where it stands, and the way in (screens/trial.ts). */
function renderTrialEntry(view: HabitSettingsView, onOpen: () => void): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block g-group settings-rows';
  const row = document.createElement('div');
  row.className = 'settings-switch';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pill sm';
  button.dataset.testid = 'open-trial';
  button.textContent = view.trialAction;
  button.addEventListener('click', onOpen);
  const note = document.createElement('span');
  note.className = 'settings-note';
  note.dataset.testid = 'trial-line';
  note.textContent = view.trialLine;
  row.append(button, note);
  body.appendChild(row);
  return section('The trial', body);
}

/** A settings row with a .g-switch: the note left, the switch right (the narration switch's idiom). */
function switchRow(o: {
  testid: string;
  on: boolean;
  name: string;
  note: string;
  onChange?: (on: boolean) => void;
  disabled?: boolean;
}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'settings-switch';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'g-switch settings-toggle-switch';
  button.dataset.testid = o.testid;
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(o.on));
  button.dataset.on = String(o.on);
  button.textContent = o.on ? 'On' : 'Off';
  button.appendChild(switchTrack());
  button.setAttribute('aria-label', `${o.name}: ${o.on ? 'on' : 'off'}`);
  button.disabled = o.disabled === true;
  button.addEventListener('click', () => o.onChange?.(!o.on));
  const note = document.createElement('span');
  note.className = 'settings-note';
  note.dataset.testid = `${o.testid}-note`;
  const title = document.createElement('b');
  title.className = 'settings-row-title';
  title.textContent = o.name;
  note.append(title, document.createTextNode(` ${o.note}`));
  wrap.append(button, note);
  return wrap;
}

/** A settings row with a segmented control (the theme's idiom: aria-pressed buttons and one sliding thumb). */
function segRow<T extends string>(o: {
  testid: string;
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  note: string;
  noteTestid: string;
  onChange?: (id: T) => void;
  disabled?: boolean;
}): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-switch';
  const group = document.createElement('div');
  group.className = 'g-seg g-seg-sm settings-seg';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', o.label);
  group.dataset.testid = o.testid;
  group.dataset.value = o.value;
  for (const option of o.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = `${o.testid}-${option.id}`;
    const active = option.id === o.value;
    button.setAttribute('aria-pressed', String(active));
    button.textContent = option.label;
    button.disabled = o.disabled === true;
    button.addEventListener('click', () => {
      if (option.id !== o.value) o.onChange?.(option.id);
    });
    group.appendChild(button);
  }
  const note = document.createElement('span');
  note.className = 'settings-note';
  note.dataset.testid = o.noteTestid;
  const title = document.createElement('b');
  title.className = 'settings-row-title';
  title.textContent = o.label;
  note.append(title, document.createTextNode(` ${o.note}`));
  row.append(group, note);
  attachThumb(group);
  return row;
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
  state.className = 'settings-state t-t2';
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
  button.className = 'pill sm settings-tutor-toggle';
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
  body.className = 'settings-block g-group settings-rows';

  const wrap = document.createElement('div');
  wrap.className = 'settings-switch';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'g-switch settings-toggle-switch';
  button.dataset.testid = 'speak-verdicts-toggle';
  // A real switch: the role and aria-checked drive the kit's .g-switch (mint track when ON); the
  // visible On/Off text and the aria-label are unchanged.
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(spokenVerdicts));
  // `data-on` and a bare On/Off label, which is the contract tests/e2e/voice.spec.ts already asserts.
  // Deliberately NOT the tutor switch's `data-enabled` + verb-phrase idiom: that button describes the
  // action it performs ("Turn the tutor off"), which reads as the CURRENT state on a control whose
  // state the label is also carrying. Here the label states the state and the note explains it.
  button.dataset.on = String(spokenVerdicts);
  button.textContent = spokenVerdicts ? 'On' : 'Off';
  button.appendChild(switchTrack());
  // The visible "On"/"Off" label (a voice.spec contract) does not name what it controls; an aria-label
  // does, without touching the asserted textContent.
  button.setAttribute('aria-label', `Read verdicts aloud: ${spokenVerdicts ? 'on' : 'off'}`);
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

/**
 * A sound cue on a costly verdict. Off on a fresh install and after any save that does not mention it,
 * same as spoken verdicts and for the same reason: unrequested audio is a hostile default, and the
 * verdict is fully on screen. It sits beside narration — both are opt-in local audio, neither is egress.
 * The tone is synthesized in the renderer (Web Audio); nothing is played nor sent when it is off.
 */
function renderSoundCues(soundCues: boolean, handlers: SettingsHandlers): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block g-group settings-rows';

  const wrap = document.createElement('div');
  wrap.className = 'settings-switch';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'g-switch settings-toggle-switch';
  button.dataset.testid = 'sound-cues-toggle';
  // A real switch: the role and aria-checked drive the kit's .g-switch (mint track when ON); the
  // visible On/Off text and the aria-label are unchanged.
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-checked', String(soundCues));
  // Same `data-on` + bare On/Off contract as the narration switch (voice.spec's idiom), so an e2e can
  // read the state the same way; the aria-label names what it controls without touching the label text.
  button.dataset.on = String(soundCues);
  button.textContent = soundCues ? 'On' : 'Off';
  button.appendChild(switchTrack());
  button.setAttribute('aria-label', `Play a sound on a mistake: ${soundCues ? 'on' : 'off'}`);
  button.addEventListener('click', () => handlers.onSoundCuesChange(!soundCues));
  wrap.appendChild(button);

  const note = document.createElement('span');
  note.className = 'settings-note';
  note.dataset.testid = 'sound-cues-note';
  note.textContent = soundCues
    ? 'On. A short tone plays on this machine when a decision costs chips — nothing is sent anywhere. The verdict still shows on screen.'
    : 'Off. Verdicts are shown, never chimed.';
  wrap.appendChild(note);

  body.appendChild(wrap);
  return section('A sound on a mistake', body);
}

/**
 * The visual theme. A device/display preference with no egress — the choice is stored in the settings
 * file (not the profile) and applied as a documentElement attribute the bundled CSS keys off. Graphite
 * is the default and the value :root paints before any JS. Each option is a pressed/unpressed button so
 * an e2e can read the active theme off aria-pressed without depending on colour. The default's id stays
 * 'graphite' so saved settings keep resolving; what it paints is now the glass look (styles-glass.css).
 */
const THEME_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'graphite', label: 'Glass' },
  { id: 'obsidian', label: 'Obsidian' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'library', label: 'Library' },
];

function renderTheme(theme: string, handlers: SettingsHandlers): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-block g-group settings-rows';

  // One row: the note, then the segmented control (one sliding thumb under the pressed option).
  const row = document.createElement('div');
  row.className = 'settings-switch';

  const group = document.createElement('div');
  group.className = 'g-seg settings-theme';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Visual theme');
  group.dataset.testid = 'theme-select';
  group.dataset.theme = theme;

  for (const option of THEME_OPTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.testid = `theme-option-${option.id}`;
    const active = option.id === theme;
    button.setAttribute('aria-pressed', String(active));
    button.textContent = option.label;
    button.setAttribute('aria-label', `Theme ${option.label}: ${active ? 'selected' : 'not selected'}`);
    button.addEventListener('click', () => {
      if (option.id !== theme) handlers.onThemeChange(option.id);
    });
    group.appendChild(button);
  }
  row.appendChild(group);
  attachThumb(group);

  const note = document.createElement('span');
  note.className = 'settings-note';
  note.dataset.testid = 'theme-note';
  note.textContent = 'Applies instantly and stays on this machine. Every theme is dark.';
  row.appendChild(note);
  body.appendChild(row);

  return section('Theme', body);
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
function renderProfileSection(status: SettingsStatus, handlers: SettingsHandlers, transfer?: HTMLElement): HTMLElement {
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

  const readOnly = status.profile.readOnly ?? null;
  if (readOnly !== null) {
    body.appendChild(paragraph(readOnlyExplanation(readOnly, status.profile.fileSchemaVersion), 'read-only-notice'));
  } else if (status.profile.migratedFrom != null) {
    body.appendChild(
      paragraph(
        status.profile.preMigrationCopy
          ? `Your profile was upgraded to format ${status.profile.schemaVersion ?? ''} at this start. The original file was kept, untouched, next to it.`
          : `Your profile was upgraded to format ${status.profile.schemaVersion ?? ''} at this start.`,
        'migration-notice',
      ),
    );
  }

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

  if (transfer !== undefined) body.appendChild(transfer);
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

export type ReadOnlyReason = 'newer-version' | 'changed-elsewhere';

/** The long form of the read-only banner (main.ts shows the short one over every screen). */
export function readOnlyExplanation(reason: ReadOnlyReason, fileVersion?: number): string {
  if (reason === 'newer-version') {
    return `This profile was saved by a newer version of Offsuit${fileVersion ? ` (format ${fileVersion})` : ''}. It is open read-only: nothing you do here is saved, so the newer version's data stays exactly as it was. Open it in that version to keep practising.`;
  }
  return 'The profile file was changed by another copy of Offsuit while this one was open. To keep that copy’s progress, this one has stopped saving. Restart Offsuit to pick up the latest profile.';
}

/** The short form, for the banner. `save-failing` is the renderer's own state: writes are failing. */
export function readOnlyHeadline(reason: ReadOnlyReason | 'save-failing'): string {
  if (reason === 'newer-version') return 'Read-only: this profile is from a newer Offsuit. Nothing here is saved.';
  if (reason === 'changed-elsewhere') return 'Not saving: another copy of Offsuit changed this profile. Restart to continue.';
  return 'Not saving: the profile could not be written (is the disk full?). Free some space and keep Offsuit open: the next action saves everything.';
}
