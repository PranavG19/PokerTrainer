import { text } from './dom.js';
import { renderCard } from './card.js';
import { renderDee } from './dee.js';
import { keepsakeMedal } from './storyArt.js';
import { commitAnswer, pendingStep, startDialogue, type DialogueScript, type DialogueState, type LessonFacts } from '../../core/dee/dialogue.js';
import type { Line, Tone } from '../../core/dee/types.js';
import { answerBoss, isClean, pendingAsk, startBoss, type BossHand, type BossRun, type PlayedMove } from '../../core/story/boss.js';
import type { Keepsake } from '../../core/story/keepsakes.js';
import { storyLine, type SpokenStoryLine } from '../../core/story/campaign.js';
import type { ActionKind } from '../../core/table.js';

/**
 * The Long Orbit's shared pieces (screens/story.ts, screens/storyRooms.ts): small DOM helpers, Dee's story line, the
 * lesson-dialogue beat and the boss-hand beat. Each beat is a little controller that owns its own state and paints
 * into the screen's beat column through `nodes()`; the screen re-paints on `repaint`. No number is computed here:
 * the dialogue's come from the lesson example, the boss hand's from the engine (core/story/boss.ts).
 */

export interface StoryDee {
  readonly tone: Tone;
  readonly character: boolean;
}

export function hash(value: string): number {
  let h = 2166136261;
  for (const ch of value) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, testid?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (testid) node.dataset.testid = testid;
  return node;
}

export function button(label: string, className: string, testid: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, testid);
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** One Dee line with the mark beside it (hidden, with the mark, when Character is off). */
export function deeLine(line: SpokenStoryLine, testid: string, size: number, by?: string): HTMLElement {
  const wrap = el('div', 'story-dee', testid);
  wrap.dataset.lineId = line.lineId;
  wrap.dataset.pose = line.pose;
  wrap.appendChild(renderDee(line.pose, size));
  const body = el('div', 'story-dee-body');
  body.appendChild(text('p', 'story-dee-say', line.text));
  if (by) body.appendChild(text('span', 'g-caption', by));
  wrap.appendChild(body);
  return wrap;
}

export function heading(label: string): HTMLElement {
  const h = text('h3', 't-t3 story-beat-head', label);
  h.tabIndex = -1;
  return h;
}

export interface BeatHost {
  /** The polite live region the screen mounted once. */
  readonly announcer: HTMLElement;
  /** The beat column, for moving focus after a repaint. */
  readonly beat: HTMLElement;
  readonly repaint: () => void;
}

// ── the lesson-dialogue beat ─────────────────────────────────────────────────────────────────────────

export interface DialogueBeat {
  nodes(title: string): Node[];
}

/**
 * The lesson as a dialogue (dee/dialogue.ts): Dee asks, the learner picks and commits, a wrong answer gets a question
 * back. `onDone` fires once, the first time the script is answered to the end; `next` is the button shown after.
 */
export function dialogueBeat(opts: {
  script: DialogueScript;
  facts: LessonFacts;
  dee: StoryDee;
  seed: number;
  bank: readonly Line[];
  done: boolean;
  host: BeatHost;
  onDone: () => void;
  next: { label: string; testid: string; onClick: () => void };
}): DialogueBeat {
  const dialogueOpts = { tone: opts.dee.tone, seed: opts.seed, character: opts.dee.character, bank: opts.bank };
  let dialogue: DialogueState = startDialogue(opts.script, opts.facts, dialogueOpts);
  let picked: string | null = null;
  let done = opts.done;
  const { host } = opts;

  return {
    nodes(title: string): Node[] {
      const out: Node[] = [heading(title)];
      const wrap = el('div', 'dee-dialogue story-dialogue', 'dee-dialogue');
      wrap.dataset.done = String(dialogue.done);
      const thread = el('ol', 'dee-thread', 'dee-thread');
      thread.setAttribute('aria-label', opts.dee.character ? 'The lesson, with Dee' : 'The lesson');
      const lastDee = [...dialogue.thread].reverse().find((t) => t.who === 'dee');
      // Only the newest few turns: the beat column is short, and the whole thread is in the announcer's history.
      for (const turn of dialogue.thread.slice(-5)) {
        const li = el('li', `dee-turn ${turn.who === 'dee' ? 'from-dee' : 'from-you'}`, turn.who === 'dee' ? 'dee-turn' : 'you-turn');
        const who = text('span', 'dee-who g-caption', turn.who === 'dee' ? (opts.dee.character ? 'Dee' : 'Coach') : turn.right ? 'You' : 'You · not yet');
        if (turn.who === 'dee') {
          li.dataset.lineId = turn.lineId;
          if (opts.dee.character && turn === lastDee) li.appendChild(renderDee(turn.pose, 40));
        } else li.dataset.right = String(turn.right);
        const body = el('div', 'dee-turn-body');
        body.append(who, text('p', 'dee-say', turn.text));
        li.appendChild(body);
        thread.appendChild(li);
      }
      wrap.appendChild(thread);
      const pending = pendingStep(opts.script, dialogue, opts.facts);
      if (pending) {
        const ask = el('div', 'dee-ask', 'dialogue-ask');
        const group = el('div', 'dee-options');
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', 'Your answer');
        for (const option of pending.options) {
          const b = button(option.label, 'pill dee-option', 'dialogue-option', () => {
            picked = option.id;
            host.repaint();
            host.beat.querySelector<HTMLElement>(`[data-option-id="${option.id}"]`)?.focus();
          });
          b.dataset.optionId = option.id;
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(picked === option.id));
          b.disabled = option.tried;
          group.appendChild(b);
        }
        const commit = button('Commit', 'pill primary', 'dialogue-commit', () => {
          if (picked === null) return;
          const before = dialogue;
          dialogue = commitAnswer(opts.script, dialogue, opts.facts, picked, dialogueOpts);
          picked = null;
          host.announcer.textContent = dialogue.thread.slice(before.thread.length).filter((t) => t.who === 'dee').map((t) => t.text).join(' ');
          if (dialogue.done && !done) {
            done = true;
            opts.onDone();
          }
          host.repaint();
          (host.beat.querySelector<HTMLElement>('[data-testid="dialogue-option"]:not(:disabled)') ??
            host.beat.querySelector<HTMLElement>(`[data-testid="${opts.next.testid}"]`))?.focus();
        });
        commit.disabled = picked === null;
        ask.append(group, commit);
        wrap.appendChild(ask);
        wrap.appendChild(text('p', 'g-caption dee-ask-note', 'A wrong answer gets a question back, not a grade.'));
      } else {
        wrap.appendChild(button(opts.next.label, 'pill', opts.next.testid, opts.next.onClick));
      }
      out.push(wrap);
      return out;
    },
  };
}

// ── the boss-hand beat ──────────────────────────────────────────────────────────────────────────────

const STREET_LABEL = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' } as const;
const ACTION_LABEL: Readonly<Record<ActionKind, string>> = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', allin: 'All-in' };

function moveText(m: PlayedMove, rival: string): string {
  const hero = m.who === 'hero';
  const say = (you: string, they: string): string => (hero ? `You ${you}` : `${rival} ${they}`);
  switch (m.kind) {
    case 'call':
      return say(`call ${m.chips}`, `calls ${m.chips}`);
    case 'bet':
      return say(`bet ${m.chips}`, `bets ${m.chips}`);
    case 'raise':
      return say(`raise to ${m.chips}`, `raises to ${m.chips}`);
    case 'allin':
      return say('go all-in', 'goes all-in');
    case 'check':
      return say('check', 'checks');
    case 'fold':
      return say('fold', 'folds');
  }
}

export interface BossBeat {
  nodes(): Node[];
}

/**
 * A boss hand (core/story/boss.ts): the setup, then the hand so far with the engine's numbers, Dee's ask and the
 * actions the engine offers there. A wrong answer gets a question back and the hand waits. At the end the rival's
 * cards turn over, Dee says what they were, and a clean hand files the keepsake (`onFinish`, once per play).
 */
export function bossBeat(opts: {
  boss: BossHand;
  /** What the rival is called here: their name once unmasked, else the room's regular. */
  rivalName: string;
  keepsake: Keepsake | null;
  /** The keepsake was already kept before this play. */
  kept: boolean;
  dee: StoryDee;
  host: BeatHost;
  onFinish: (clean: boolean) => void;
}): BossBeat {
  const { boss, host } = opts;
  let run: BossRun | null = null;
  let picked: ActionKind | null = null;
  let finished = false;

  function deal(): void {
    run = startBoss(boss);
    picked = null;
    finished = false;
    host.announcer.textContent = pendingAsk(run)?.text ?? '';
    host.repaint();
    host.beat.querySelector<HTMLElement>('[data-testid="boss-option"]')?.focus();
  }

  function cards(r: BossRun | null): HTMLElement {
    const row = el('div', 'boss-cards');
    const you = el('div', 'boss-hole');
    you.appendChild(text('span', 'g-caption', 'You'));
    const yc = el('span', 'g-mini');
    for (const c of boss.hero) yc.appendChild(renderCard(c, { small: true }));
    you.appendChild(yc);
    const board = el('div', 'boss-board', 'boss-board');
    board.appendChild(text('span', 'g-caption', 'Board'));
    const bc = el('span', 'g-mini');
    // Only the cards dealt so far: a street not reached is not a card yet.
    const shown = r ? r.state.board : [];
    for (const c of shown) bc.appendChild(renderCard(c, { small: true }));
    if (shown.length === 0) bc.appendChild(text('span', 'g-caption', 'Not dealt yet'));
    board.appendChild(bc);
    const them = el('div', 'boss-hole', 'boss-rival-cards');
    them.dataset.shown = String(Boolean(r?.done));
    them.appendChild(text('span', 'g-caption', opts.rivalName));
    const tc = el('span', 'g-mini');
    for (const c of boss.rival) tc.appendChild(renderCard(c, { small: true, faceDown: !r?.done }));
    them.appendChild(tc);
    row.append(you, board, them);
    return row;
  }

  function history(r: BossRun): HTMLElement {
    const list = el('ol', 'g-sect g-flat boss-history', 'boss-history');
    list.setAttribute('aria-label', 'The hand so far');
    for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
      const moves = r.played.filter((m) => m.street === street);
      if (moves.length === 0) continue;
      const li = el('li', 'boss-history-row');
      li.append(text('span', 'g-label', STREET_LABEL[street]), text('span', 'g-sub', moves.map((m) => moveText(m, opts.rivalName)).join(' · ')));
      list.appendChild(li);
    }
    return list;
  }

  return {
    nodes(): Node[] {
      const out: Node[] = [heading(boss.title)];
      const root = el('div', 'boss-beat', 'boss-beat');
      root.dataset.boss = boss.id;
      root.dataset.phase = run === null ? 'setup' : run.done ? 'done' : 'ask';
      out.push(root);
      root.appendChild(text('p', 'g-sub story-lesson-line', boss.setup));
      root.appendChild(cards(run));
      if (run === null) {
        root.appendChild(text('p', 'g-caption', 'Judged on the decisions alone. Right at every first answer keeps this room’s keepsake.'));
        root.appendChild(button('Deal the hand', 'pill', 'boss-deal', deal));
        return out;
      }
      const r = run;
      root.appendChild(history(r));
      const last = r.replies[r.replies.length - 1];
      const pending = pendingAsk(r);
      if (pending) {
        const ask = el('div', 'boss-ask', 'boss-ask');
        const line: SpokenStoryLine = { lineId: `boss.${boss.id}.${pending.ask.id}`, pose: 'thinking', text: pending.text };
        ask.appendChild(opts.dee.character ? deeLine(line, 'boss-ask-line', 28) : text('p', 'story-dee-say', pending.text));
        if (last && !last.right) {
          const back = el('p', 'g-sub boss-back', 'boss-back');
          back.textContent = last.text;
          ask.appendChild(back);
        }
        const group = el('div', 'dee-options');
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', 'Your action');
        for (const o of pending.options) {
          const b = button(ACTION_LABEL[o.kind], 'pill dee-option', 'boss-option', () => {
            picked = o.kind;
            host.repaint();
            host.beat.querySelector<HTMLElement>(`[data-kind="${o.kind}"]`)?.focus();
          });
          b.dataset.kind = o.kind;
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-checked', String(picked === o.kind));
          b.disabled = o.tried;
          group.appendChild(b);
        }
        const commit = button('Commit', 'pill primary', 'boss-commit', () => {
          if (picked === null || run === null) return;
          run = answerBoss(run, picked);
          picked = null;
          const reply = run.replies[run.replies.length - 1];
          const next = pendingAsk(run);
          host.announcer.textContent = [reply?.text, next?.text].filter(Boolean).join(' ');
          if (run.done && !finished) {
            finished = true;
            opts.onFinish(isClean(run));
          }
          host.repaint();
          (host.beat.querySelector<HTMLElement>('[data-testid="boss-option"]:not(:disabled)') ??
            host.beat.querySelector<HTMLElement>('[data-testid="boss-again"]'))?.focus();
        });
        commit.disabled = picked === null;
        const row = el('div', 'dee-ask');
        row.append(group, commit);
        ask.appendChild(row);
        root.appendChild(ask);
        return out;
      }
      // The end: the cards are over, Dee says what they were, and the result is the decisions'.
      const clean = isClean(r);
      const result = el('div', 'story-debrief boss-result', 'boss-result');
      result.dataset.clean = String(clean);
      const score = el('div', 'story-debrief-score');
      score.append(
        text('span', 't-head', clean ? 'Clean' : 'Right in the end'),
        text('span', 'g-caption', clean ? 'every decision right at the first answer' : `${r.misses} first ${r.misses === 1 ? 'answer' : 'answers'} not yet right`),
      );
      result.appendChild(score);
      if (last?.right) result.appendChild(text('p', 'g-sub', last.text));
      root.appendChild(result);
      const reveal: SpokenStoryLine = { lineId: `boss.${boss.id}.reveal`, pose: 'rest', text: boss.reveal };
      if (opts.dee.character) root.appendChild(deeLine(reveal, 'boss-reveal', 28));
      const k = opts.keepsake;
      const said = storyLine(clean ? 'boss-clean' : 'boss-again', { keepsake: k?.name ?? '' }, { tone: opts.dee.tone, seed: hash(boss.id), character: opts.dee.character });
      if (k && (clean || opts.kept)) {
        const keep = el('div', 'boss-keepsake', 'boss-keepsake');
        keep.appendChild(keepsakeMedal(k.glyph, true, 40));
        const t = el('div', 'story-unmask-text');
        t.append(text('div', 't-head', k.name), text('div', 'g-caption', clean && !opts.kept ? `Kept · ${k.fact}` : `On the shelf · ${k.fact}`));
        keep.appendChild(t);
        root.appendChild(keep);
      }
      if (said) root.appendChild(deeLine(said, 'boss-said', 28));
      root.appendChild(button('Play it again', 'pill', 'boss-again', deal));
      return out;
    },
  };
}
