import '../styles-dee.css';

import { gradeDecision } from '../../core/coach.js';
import { gradeFacts, isPriceHeld, selectLine, type DeeContext } from '../../core/dee/engine.js';
import { DEE_BANK } from '../../core/dee/bank.js';
import { VILLAIN_BETTING_RANGE } from '../../core/preflop.js';
import { FREQUENCIES, TONES, type DeeEvent, type DeePose, type Frequency, type Tone } from '../../core/dee/types.js';
import { renderDee, setDeePose } from '../components/dee.js';
import { text } from '../components/dom.js';
import { attachThumb } from '../components/thumb.js';

/**
 * DEE'S SETTINGS (demo/vision/dee-settings.html): the personality dial with a live preview, when Dee speaks,
 * the Character switch, and what Dee remembers. The screen updates itself in place, so the preview moment
 * survives a change of tone; every change is persisted through the handlers.
 *
 * The preview's numbers are real engine output: fixed demonstration spots graded by coach.ts (previewEvents),
 * so even the preview never shows a number Dee wrote.
 */

export interface DeeSettingsHandlers {
  onTone: (tone: Tone) => void;
  onFrequency: (frequency: Frequency) => void;
  onCharacter: (on: boolean) => void;
  onForgetRules: () => void;
}

const TONE_LABEL: Record<Tone, string> = { dry: 'Dry', warm: 'Warm', blunt: 'Blunt' };
const FREQUENCY_COPY: Record<Frequency, [string, string]> = {
  normal: ['After notable hands', 'A mistake, or a close price that held'],
  mistakes: ['Mistakes only', 'A mistake, or a right move for the wrong reason'],
  sessions: ['After sessions only', 'A short summary, nothing between hands'],
};

type Moment = 'hand' | 'mistake' | 'rest' | 'idle';
const MOMENTS: [Moment, string][] = [
  ['rest', 'At rest'],
  ['hand', 'After a hand'],
  ['mistake', 'A mistake'],
  ['idle', 'Idle'],
];
const MOMENT_POSE: Record<Moment, DeePose> = { rest: 'rest', hand: 'price-held', mistake: 'serious', idle: 'asleep' };
const MOMENT_NAME: Record<Moment, string> = {
  rest: 'at rest',
  hand: 'pleased: a price that held',
  mistake: 'serious: a mistake',
  idle: 'asleep',
};
const QUIET: Record<'rest' | 'idle', string> = {
  rest: 'Dee waits on the perch. Nothing to say yet.',
  idle: 'Two quiet minutes, and Dee lies flat until you are back.',
};

/**
 * Two demonstration spots, graded by the engine. After a hand: Q♥J♦ calling 75 into 225 on T♥6♦2♥, a close
 * price that held (the call needs 25%, the hand has about 31%). A mistake: K♥2♦ folding to 75 into 225 on
 * 4♠4♦K♦, with the hand far ahead of the price.
 */
function previewEvents(): Record<'hand' | 'mistake', DeeEvent | null> {
  const base = { street: 'flop', pot: 225, toCall: 75, stack: 4950, bb: 50, opponents: 1, seed: 7, villainRange: VILLAIN_BETTING_RANGE } as const;
  const call = gradeDecision({ ...base, hole: ['Qh', 'Jd'], board: ['Th', '6d', '2h'], chosen: 'call' });
  const fold = gradeDecision({ ...base, hole: ['Kh', '2d'], board: ['4s', '4d', 'Kd'], chosen: 'fold' });
  // The preview may only claim a price held if the engine's own rule says it did.
  const held = isPriceHeld({ grade: call, action: 'call', street: base.street, toCall: base.toCall, pot: base.pot, confidence: 'sure', reasonCategory: 'price', rightForWrongReason: false });
  return {
    hand: held ? { kind: 'price-held', priced: true, facts: gradeFacts(call, base.toCall, base.pot) } : null,
    mistake: {
      kind: 'verdict',
      severity: fold.severity === 'serious' ? 'serious' : 'notable',
      principle: 'pot odds',
      action: 'fold',
      priced: true,
      facts: gradeFacts(fold, base.toCall, base.pot),
    },
  };
}

/** The preview shows lines written in all three voices, so turning the dial visibly changes the words. */
const PREVIEW_BANK = DEE_BANK.filter((l) => l.dry !== undefined && l.blunt !== undefined);

export function renderDeeSettings(opts: {
  context: DeeContext;
  rulesRemembered: number;
  newestRule: string | null;
  handlers: DeeSettingsHandlers;
  /** The "Smarter phrasing" row (components/phrasingRow.ts), owned by the caller so progress repaints in place. */
  phrasing?: HTMLElement;
  /** Open onboarding's questions again (every answer is editable later). */
  onRedoOnboarding?: () => void;
}): HTMLElement {
  let tone = opts.context.tone;
  let frequency = opts.context.frequency;
  let character = opts.context.character;
  let moment: Moment = 'hand';
  const events = previewEvents();

  const root = document.createElement('div');
  root.className = 'dee-settings';
  root.dataset.testid = 'dee-settings';

  const head = document.createElement('div');
  head.className = 'dee-settings-head';
  head.appendChild(text('h1', 't-t2', 'Dee'));
  head.appendChild(text('p', 'g-sub', 'The coach’s voice at the table. The numbers are the engine’s; Dee only phrases them.'));
  if (opts.onRedoOnboarding) {
    const redo = document.createElement('button');
    redo.type = 'button';
    redo.className = 'pill quiet';
    redo.dataset.testid = 'dee-redo-onboarding';
    redo.textContent = 'Your answers about your game';
    redo.addEventListener('click', opts.onRedoOnboarding);
    head.appendChild(redo);
  }
  root.appendChild(head);

  const cols = document.createElement('div');
  cols.className = 'dee-settings-cols';
  root.appendChild(cols);

  // ── the stage: Dee live, the dial, the line in that voice ──
  const stage = document.createElement('section');
  stage.className = 'dee-stage';
  stage.setAttribute('aria-label', 'Preview Dee');
  const mark = renderDee(MOMENT_POSE[moment], 112);
  mark.classList.add('dee-hero');
  const markWrap = document.createElement('div');
  markWrap.className = 'dee-stage-mark';
  markWrap.dataset.testid = 'dee-preview-mark';
  markWrap.setAttribute('role', 'img');
  markWrap.appendChild(mark);
  stage.appendChild(markWrap);

  const dial = segmented(
    'Personality',
    'dee-tone',
    TONES.map((t) => [t, TONE_LABEL[t]] as const),
    () => tone,
    (t) => {
      tone = t;
      opts.handlers.onTone(t);
      paintPreview();
    },
  );
  stage.appendChild(dial);

  const preview = document.createElement('div');
  preview.className = 'dee-preview';
  preview.setAttribute('aria-live', 'polite');
  const say = text('p', 'dee-preview-line', '');
  say.dataset.testid = 'dee-preview-line';
  preview.appendChild(say);
  preview.appendChild(text('p', 'g-caption', 'Same numbers in every voice. Only the words around them change.'));
  stage.appendChild(preview);

  stage.appendChild(
    segmented(
      'Preview a moment',
      'dee-moment',
      MOMENTS,
      () => moment,
      (m) => {
        moment = m;
        paintPreview();
      },
      true,
    ),
  );
  cols.appendChild(stage);

  function paintPreview(): void {
    setDeePose(mark, MOMENT_POSE[moment]);
    markWrap.setAttribute('aria-label', `Dee, ${MOMENT_NAME[moment]}`);
    if (moment === 'hand' || moment === 'mistake') {
      const event = events[moment];
      const line = event === null ? null : selectLine(event, { tone, quietness: 1, character: true }, { handsWatched: 0, said: [] }, 1, PREVIEW_BANK);
      say.textContent = line?.text ?? '';
      say.dataset.lineId = line?.lineId ?? '';
    } else {
      say.textContent = QUIET[moment];
      delete say.dataset.lineId;
    }
    root.dataset.tone = tone;
  }

  // ── the settings column ──
  const side = document.createElement('section');
  side.className = 'dee-side';
  side.setAttribute('aria-label', 'Dee settings');

  side.appendChild(text('h2', 'g-label dee-sect-title', 'When Dee speaks'));
  const freq = document.createElement('div');
  freq.className = 'g-group dee-freq';
  freq.setAttribute('role', 'radiogroup');
  freq.setAttribute('aria-label', 'When Dee speaks');
  for (const f of FREQUENCIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'g-row dee-choice';
    b.dataset.testid = `dee-frequency-${f}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(f === frequency));
    const body = document.createElement('span');
    body.className = 'dee-choice-body';
    body.append(text('span', 'dee-choice-title', FREQUENCY_COPY[f][0]), text('span', 'g-caption', FREQUENCY_COPY[f][1]));
    const tick = document.createElement('span');
    tick.className = 'dee-choice-tick';
    tick.setAttribute('aria-hidden', 'true');
    b.append(body, tick);
    b.addEventListener('click', () => {
      frequency = f;
      for (const x of freq.querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
      opts.handlers.onFrequency(f);
    });
    freq.appendChild(b);
  }
  side.appendChild(freq);
  side.appendChild(text('p', 'g-caption dee-hush', 'Dee never talks while you are to act. The words wait until the hand is over.'));

  const charGroup = document.createElement('div');
  charGroup.className = 'g-group';
  const charRow = document.createElement('div');
  charRow.className = 'dee-opt';
  const charText = document.createElement('span');
  charText.className = 'dee-choice-body';
  charText.append(
    text('span', 'dee-choice-title', 'Character'),
    text('span', 'g-caption', 'Off hides Dee everywhere. The coach’s verdicts stay.'),
  );
  const charSwitch = document.createElement('button');
  charSwitch.type = 'button';
  charSwitch.className = 'g-switch';
  charSwitch.dataset.testid = 'dee-character-toggle';
  charSwitch.setAttribute('role', 'switch');
  charSwitch.setAttribute('aria-label', 'Character');
  const track = document.createElement('span');
  track.className = 'g-switch-track';
  track.setAttribute('aria-hidden', 'true');
  charSwitch.appendChild(track);
  const paintCharacter = (): void => {
    charSwitch.setAttribute('aria-checked', String(character));
    charSwitch.dataset.on = String(character);
    root.dataset.character = character ? 'on' : 'off';
  };
  charSwitch.addEventListener('click', () => {
    character = !character;
    paintCharacter();
    opts.handlers.onCharacter(character);
  });
  charRow.append(charText, charSwitch);
  charGroup.appendChild(charRow);
  side.appendChild(charGroup);

  side.appendChild(text('h2', 'g-label dee-sect-title', 'What Dee remembers'));
  const mem = document.createElement('div');
  mem.className = 'g-group';
  const memRow = document.createElement('div');
  memRow.className = 'dee-opt';
  const memText = document.createElement('span');
  memText.className = 'dee-choice-body';
  const count = text('span', 'dee-choice-title', '');
  count.dataset.testid = 'dee-rules-count';
  const memCaption = text('span', 'g-caption', '');
  memText.append(count, memCaption);
  const forget = document.createElement('button');
  forget.type = 'button';
  forget.className = 'pill quiet sm';
  forget.dataset.testid = 'dee-forget-rules';
  forget.textContent = 'Forget';
  let remembered = opts.rulesRemembered;
  const paintMemory = (): void => {
    count.textContent = remembered === 1 ? 'Your rules: 1 sentence' : `Your rules: ${remembered} sentences`;
    memCaption.textContent =
      remembered > 0 && opts.newestRule ? `Quoted back where it applies: “${opts.newestRule}”` : 'Sentences you adopt in lessons are quoted back at the table.';
    forget.disabled = remembered === 0;
    forget.setAttribute('aria-label', 'Forget your rules: Dee stops quoting them. Your lesson history is kept.');
  };
  forget.addEventListener('click', () => {
    remembered = 0;
    opts.newestRule = null;
    paintMemory();
    opts.handlers.onForgetRules();
  });
  memRow.append(memText, forget);
  mem.appendChild(memRow);
  side.appendChild(mem);
  side.appendChild(text('p', 'g-caption', 'On this Mac only. Forget stops Dee quoting it; your lesson history is kept.'));
  if (opts.phrasing) side.appendChild(opts.phrasing);
  cols.appendChild(side);

  paintPreview();
  paintCharacter();
  paintMemory();
  return root;
}

/** A labelled .g-seg radio group with the sliding thumb. */
function segmented<T extends string>(
  label: string,
  testid: string,
  items: readonly (readonly [T, string])[],
  get: () => T,
  set: (value: T) => void,
  small = false,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dee-dial';
  wrap.appendChild(text('span', 'g-label', label));
  const seg = document.createElement('div');
  seg.className = `g-seg${small ? ' g-seg-sm' : ''}`;
  seg.dataset.testid = testid;
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', label);
  for (const [value, name] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = value;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(get() === value));
    b.textContent = name;
    b.addEventListener('click', () => {
      set(value);
      for (const x of seg.querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
    });
    seg.appendChild(b);
  }
  wrap.appendChild(seg);
  attachThumb(seg);
  return wrap;
}
