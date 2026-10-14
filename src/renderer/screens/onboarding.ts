import '../styles-habit.css';
import type { Personalization } from '../../core/progression/types.js';
import { MAX_GOALS } from '../../core/progression/persist.js';
import { TONES, type Tone } from '../../core/dee/types.js';
import { SESSION_LENGTHS } from '../../core/sessionPlan.js';
import { renderDee } from '../components/dee.js';

/**
 * ONBOARDING (1.9): five sheets, asked once, every one skippable, every answer editable later. Each question says
 * what Dee uses it for, and only claims a use that exists in this build; an answer nothing reads yet says so.
 *
 * It sits in the screen region, never over the tab bar, so nothing is locked behind it (N1): any tab is one
 * click away the whole time. Nothing is saved until Skip or the last sheet's button, and then only what was
 * answered (an unanswered question stays empty, never a guess).
 */

export interface OnboardingResult {
  readonly personalization: Omit<Personalization, 'answeredOn'>;
  readonly tone: Tone;
  readonly spokenVerdicts: boolean;
}

export interface OnboardingProps {
  readonly initial: Personalization;
  readonly tone: Tone;
  readonly spokenVerdicts: boolean;
  /** Skip or finish: save what was answered. `finished` = the last sheet's button. */
  readonly onDone: (result: OnboardingResult, finished: boolean) => void;
  /** Every change, so a sheet left for another tab reopens with the answers kept. */
  readonly onDraft?: (result: OnboardingResult) => void;
  /** The last sheet's button. Default "Deal my first hand" (first run); a reopen from settings says "Save". */
  readonly finishLabel?: string;
  /** A reopen from settings: Skip reads "Cancel" and it, like Escape, discards the edits instead of saving them. */
  readonly onCancel?: () => void;
}

const FORMATS = [
  ['home', 'Home game', 'Friends, one table, a regular night'],
  ['online', 'Online', 'Fast tables, strangers, many hands'],
  ['live', 'Live casino', 'A dealer, a rake, nine seats'],
  ['learning', 'Just learning', 'No game yet, starting clean'],
] as const;
const STAKES = [
  ['play-money', 'Free'],
  ['low', '$1/$2'],
  ['mid', '$2/$5'],
  ['high', '$5/$10+'],
] as const;
const EXPERIENCE = [
  ['new', 'New'],
  ['years-unstudied', 'A few years, never studied'],
  ['studied', 'I study'],
] as const;
const GOALS = [
  ['home-game', 'Win my home game', 'Beat the regulars I sit with'],
  ['understand-losses', 'Understand why I lose', 'Find the spots that cost me'],
  ['move-up', 'Move up stakes', 'Be ready for a bigger game'],
  ['puzzle', 'The puzzle', 'I like working hands out'],
] as const;
const WHY = [
  ['friends', 'The friends'],
  ['puzzle', 'The puzzle'],
  ['competition', 'The competition'],
  ['unwind', 'To unwind'],
] as const;
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TONE_SAMPLE: Record<Tone, string> = {
  dry: 'Calling 75 into 225 needed 25%. You had 40%. The fold was the expensive part.',
  warm: 'That one needed 25% and the hand had 40%, so it was a call.',
  blunt: 'Needed 25%. Had 40%. Call.',
};
const TONE_LABEL: Record<Tone, string> = { dry: 'Dry', warm: 'Warm', blunt: 'Blunt' };

export const ONBOARDING_STEPS = 5;

export function renderOnboarding(props: OnboardingProps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'onboarding';
  root.dataset.testid = 'onboarding';
  const sheet = document.createElement('section');
  sheet.className = 'onboarding-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'false');
  sheet.setAttribute('aria-label', 'Dee: a few questions about your game');
  root.appendChild(sheet);

  const a = {
    displayName: props.initial.displayName,
    goals: [...props.initial.goals],
    format: props.initial.format,
    stakes: props.initial.stakes,
    experience: props.initial.experience,
    why: [...props.initial.why],
    days: [...(props.initial.schedule?.days ?? [])],
    sessionMinutes: props.initial.schedule?.sessionMinutes ?? null,
    tone: props.tone,
    spokenVerdicts: props.spokenVerdicts,
  };
  let step = 1;

  function result(): OnboardingResult {
    const schedule = a.days.length > 0 || a.sessionMinutes !== null ? { days: [...a.days].sort((x, y) => x - y), sessionMinutes: a.sessionMinutes } : null;
    const name = a.displayName?.trim() ?? '';
    return {
      personalization: {
        displayName: name === '' ? null : name.slice(0, 40),
        goals: a.goals.slice(0, MAX_GOALS),
        format: a.format,
        stakes: a.stakes,
        experience: a.experience,
        why: a.why,
        schedule,
      },
      tone: a.tone,
      spokenVerdicts: a.spokenVerdicts,
    };
  }

  function uses(what: string, rest = ''): HTMLElement {
    const p = document.createElement('p');
    p.className = 'onboarding-uses g-caption';
    const b = document.createElement('b');
    b.textContent = what;
    p.append('Dee uses this to ', b, rest);
    return p;
  }

  function notYet(text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'onboarding-uses g-caption';
    p.textContent = text;
    return p;
  }

  function choice<T extends string>(
    testid: string,
    options: readonly (readonly [T, string, string?])[],
    selected: (v: T) => boolean,
    toggle: (v: T) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'onboarding-choices';
    row.dataset.testid = testid;
    for (const [value, label, detail] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill';
      b.dataset.value = value;
      b.setAttribute('aria-pressed', String(selected(value)));
      b.textContent = label;
      if (detail) b.title = detail;
      b.addEventListener('click', () => {
        toggle(value);
        props.onDraft?.(result());
        paint();
      });
      row.appendChild(b);
    }
    return row;
  }

  function q(label: string, ...children: HTMLElement[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'onboarding-q';
    const l = document.createElement('div');
    l.className = 't-head';
    l.textContent = label;
    wrap.append(l, ...children);
    return wrap;
  }

  const heading = (text: string, sub: string): HTMLElement[] => {
    const h = document.createElement('h2');
    h.className = 't-t3';
    h.textContent = text;
    const p = document.createElement('p');
    p.className = 'g-sub';
    p.classList.add('habit-flush');
    p.textContent = sub;
    return [h, p];
  };

  function body(): HTMLElement[] {
    if (step === 1) {
      const input = document.createElement('input');
      input.className = 'onboarding-name';
      input.dataset.testid = 'onboarding-name';
      input.type = 'text';
      input.maxLength = 40;
      input.placeholder = 'Optional';
      input.value = a.displayName ?? '';
      input.setAttribute('aria-label', 'What should I call you?');
      input.addEventListener('input', () => {
        a.displayName = input.value;
        props.onDraft?.(result());
      });
      const rows = document.createElement('ul');
      rows.className = 'onboarding-promises g-sub';
      for (const [k, v] of [
        ['In a hand', 'I stay quiet while you are to act.'],
        ['After it', 'One line: the price, what the hand had, your rule.'],
        ['After a session', 'A short summary, from your numbers.'],
      ]) {
        const li = document.createElement('li');
        const b = document.createElement('b');
        b.textContent = `${k}: `;
        li.append(b, v);
        rows.appendChild(li);
      }
      return [
        ...heading('I’m Dee. I sit at every table you play.', 'I’m the dealer button: I go round the table every hand and never play one. I grade the decision, never the result.'),
        rows,
        q('What should I call you?', input, uses('greet you on Home', '. Leave it blank and Dee uses no name.')),
      ];
    }
    if (step === 2) {
      return [
        ...heading('Who you are at the table', 'Three taps. Nothing here is a test.'),
        q(
          'Where you play',
          choice('onboarding-format', FORMATS, (v) => a.format === v, (v) => (a.format = a.format === v ? null : v)),
          notYet('Kept on your profile. Nothing reads it yet in this build.'),
        ),
        q(
          'Stakes',
          choice('onboarding-stakes', STAKES, (v) => a.stakes === v, (v) => (a.stakes = a.stakes === v ? null : v)),
          notYet('Kept on your profile. No money is involved here, and nothing reads it yet.'),
        ),
        q(
          'Experience',
          choice('onboarding-experience', EXPERIENCE, (v) => a.experience === v, (v) => (a.experience = a.experience === v ? null : v)),
          notYet('Kept on your profile. Nothing reads it yet in this build.'),
        ),
      ];
    }
    if (step === 3) {
      return [
        ...heading('What you want from it', `Pick up to ${MAX_GOALS}. Your answers stay on this Mac.`),
        q(
          `Your goal · ${a.goals.length} chosen`,
          choice(
            'onboarding-goals',
            GOALS,
            (v) => a.goals.includes(v),
            (v) => {
              if (a.goals.includes(v)) a.goals = a.goals.filter((g) => g !== v);
              else if (a.goals.length < MAX_GOALS) a.goals = [...a.goals, v];
            },
          ),
          notYet('Kept on your profile. Today’s plan comes from your costliest spot either way.'),
        ),
        q(
          'Why you play',
          choice('onboarding-why', WHY, (v) => a.why.includes(v), (v) => (a.why = a.why.includes(v) ? a.why.filter((w) => w !== v) : [...a.why, v])),
          notYet('Kept on your profile. Nothing reads it yet in this build.'),
        ),
      ];
    }
    if (step === 4) {
      const days = choice(
        'onboarding-days',
        DAYS.map((d, i) => [String(i), d, DAY_NAMES[i]] as const),
        (v) => a.days.includes(Number(v)),
        (v) => {
          const n = Number(v);
          a.days = a.days.includes(n) ? a.days.filter((d) => d !== n) : [...a.days, n];
        },
      );
      const lengths = choice(
        'onboarding-minutes',
        SESSION_LENGTHS.map((m) => [String(m), `${m} min`] as const),
        (v) => a.sessionMinutes === Number(v),
        (v) => (a.sessionMinutes = a.sessionMinutes === Number(v) ? null : Number(v)),
      );
      return [
        ...heading('When you practise', 'A plan, not a promise. Nothing is locked if you skip a day.'),
        q('Days', days, notYet('Kept on your profile. Your streak counts every day you finish a session, any day of the week.')),
        q('A session is', lengths, uses('size the session planner on Home', '. Thirty minutes is the shortest full session.')),
      ];
    }
    const tones = document.createElement('div');
    tones.className = 'g-group';
    tones.dataset.testid = 'onboarding-tone';
    for (const t of TONES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'g-row';
      b.dataset.value = t;
      b.setAttribute('aria-pressed', String(a.tone === t));
      const l = document.createElement('span');
      l.className = 't-head';
      l.style.minWidth = '56px';
      l.textContent = TONE_LABEL[t];
      const s = document.createElement('span');
      s.className = 'g-sub';
      s.textContent = TONE_SAMPLE[t];
      b.append(l, s);
      if (a.tone === t) b.append(' ✓');
      b.addEventListener('click', () => {
        a.tone = t;
        props.onDraft?.(result());
        paint();
      });
      tones.appendChild(b);
    }
    const speak = document.createElement('button');
    speak.type = 'button';
    speak.className = 'pill';
    speak.dataset.testid = 'onboarding-speak';
    speak.setAttribute('aria-pressed', String(a.spokenVerdicts));
    speak.textContent = a.spokenVerdicts ? 'Read verdicts aloud: on' : 'Read verdicts aloud: off';
    speak.addEventListener('click', () => {
      a.spokenVerdicts = !a.spokenVerdicts;
      props.onDraft?.(result());
      paint();
    });
    const promises = document.createElement('p');
    promises.className = 'g-sub';
    promises.dataset.testid = 'onboarding-promises';
    promises.classList.add('habit-flush');
    promises.textContent = 'I never talk while you are to act. I quote your rules back in your words. The character turns off any time.';
    return [
      ...heading('How should I sound?', 'The numbers and the grade never change with it.'),
      q('Voice', tones, uses('choose the words around a verdict')),
      q('Narration', speak, uses('read the verdict aloud', ' after a costly decision, when on. Off by default.')),
      q('What I promise', promises),
    ];
  }

  function paint(): void {
    sheet.dataset.step = String(step);
    const head = document.createElement('div');
    head.className = 'onboarding-head';
    const name = document.createElement('span');
    name.className = 't-head';
    name.textContent = 'Dee';
    const count = document.createElement('span');
    count.className = 'g-caption';
    count.dataset.testid = 'onboarding-step';
    count.textContent = `Step ${step} of ${ONBOARDING_STEPS}`;
    const bar = document.createElement('span');
    bar.className = 'onboarding-steps';
    bar.setAttribute('aria-hidden', 'true');
    for (let i = 1; i <= ONBOARDING_STEPS; i++) {
      const seg = document.createElement('span');
      seg.dataset.on = String(i <= step);
      bar.appendChild(seg);
    }
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'pill quiet';
    skip.dataset.testid = 'onboarding-skip';
    skip.textContent = props.onCancel ? 'Cancel' : 'Skip';
    skip.addEventListener('click', () => (props.onCancel ? props.onCancel() : props.onDone(result(), false)));
    head.append(renderDee('rest', 24), name, count, bar, skip);

    const main = document.createElement('div');
    main.className = 'onboarding-body';
    main.append(...body());

    const foot = document.createElement('div');
    foot.className = 'onboarding-foot';
    const note = document.createElement('span');
    note.className = 'g-caption';
    note.textContent = 'Every answer stays on this Mac. Change any of it later in Dee’s settings.';
    foot.appendChild(note);
    if (step > 1) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'pill quiet';
      back.dataset.testid = 'onboarding-back';
      back.textContent = 'Back';
      back.addEventListener('click', () => {
        step -= 1;
        paint();
      });
      foot.appendChild(back);
    }
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'pill primary';
    next.dataset.testid = 'onboarding-next';
    next.textContent = step === ONBOARDING_STEPS ? (props.finishLabel ?? 'Deal my first hand') : 'Continue';
    next.addEventListener('click', () => {
      if (step === ONBOARDING_STEPS) props.onDone(result(), true);
      else {
        step += 1;
        paint();
      }
    });
    foot.appendChild(next);
    sheet.replaceChildren(head, main, foot);
  }

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') (props.onCancel ? props.onCancel() : props.onDone(result(), false));
  });
  paint();
  return root;
}
