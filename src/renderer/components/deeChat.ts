import { answerQuestion, suggestionsFor } from '../../core/dee/chat/answer.js';
import { chatTemplate } from '../../core/dee/chat/bank.js';
import { MAX_QUESTION_CHARS } from '../../core/dee/chat/gate.js';
import type { ChatAnswer, ChatContext } from '../../core/dee/chat/types.js';
import type { DeePose } from '../../core/dee/types.js';
import { renderDee, setDeePose } from './dee.js';
import { keycap } from './glyphs.js';

/**
 * The Dee chat panel: one glass sheet over the screen, in the lesson dialogue's voice (demo/vision/lesson.html):
 * Dee's turns at the left with the mark, the learner's in a quiet bubble at the right, suggestions as quiet pills,
 * one field and the one primary action.
 *
 * Every answer is computed here, synchronously, by the scripted pipeline (src/core/dee/chat): the gate, then the
 * engine's facts, then a template. That is the whole product. When the optional phrasing model is installed, the
 * template id and slots (never the question) go to main, which may return a checked rewording within its
 * 600 ms budget; otherwise the scripted text shows. Learner text is only ever set with textContent.
 *
 * Dee's rig reacts while it "thinks": the panel's mark and the perch hold `thinking` until the answer lands,
 * then the mark wears the answer's pose. Keyboard: Esc closes, Enter asks, Tab stays inside the sheet, and focus
 * returns to whatever opened it.
 */

export interface PhraseBridge {
  (req: { templateId: string; slots: Readonly<Record<string, string>> }): Promise<{ text: string | null; source: 'model' | 'script' } | unknown>;
}

export interface DeeChatOptions {
  /** Read fresh on every question, so an answer is about the table as it is now. */
  readonly context: () => ChatContext;
  /** Whether Dee is shown (Character on). Off: the coach answers, with no mark. */
  readonly character: boolean;
  readonly phrase?: PhraseBridge;
  readonly warm?: () => void;
  readonly onPerch?: (pose: DeePose | null) => void;
  readonly onOpenSettings: () => void;
  readonly onClose: () => void;
}

export interface DeeChatHandle {
  readonly root: HTMLElement;
  ask(question: string): Promise<void>;
  close(): void;
}

/** The shortest visible think, so the rig's reaction reads even when the answer is instant. */
const MIN_THINK_MS = 260;
/** The renderer's own ceiling on a rewording (main's budget is 600 ms; this covers the IPC hop). */
const MAX_WAIT_MS = 750;

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

export function renderDeeChat(opts: DeeChatOptions): DeeChatHandle {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const speaker = opts.character ? 'Dee' : 'Coach';

  const root = document.createElement('div');
  root.className = 'dee-chat-layer';
  root.dataset.testid = 'dee-chat-layer';
  const scrim = document.createElement('div');
  scrim.className = 'dee-chat-scrim';
  scrim.addEventListener('click', () => close());

  const sheet = document.createElement('section');
  sheet.className = 'dee-chat';
  sheet.dataset.testid = 'dee-chat';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'dee-chat-title');
  sheet.dataset.thinking = 'false';

  // ── head ──
  const head = document.createElement('header');
  head.className = 'dee-chat-head';
  const mark = renderDee('listening', 28);
  mark.dataset.testid = 'dee-chat-mark';
  const titles = document.createElement('div');
  titles.className = 'dee-chat-titles';
  const title = document.createElement('h2');
  title.id = 'dee-chat-title';
  title.className = 'dee-chat-title';
  title.textContent = opts.character ? 'Ask Dee' : 'Ask the coach';
  const source = document.createElement('p');
  source.className = 'g-caption dee-chat-source';
  source.dataset.testid = 'dee-chat-source';
  source.textContent = 'Every answer comes from the engine';
  titles.append(title, source);
  const settings = document.createElement('button');
  settings.type = 'button';
  settings.className = 'pill quiet sm';
  settings.dataset.testid = 'dee-chat-settings';
  settings.textContent = 'Settings';
  settings.addEventListener('click', () => {
    close();
    opts.onOpenSettings();
  });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'pill sm';
  closeBtn.dataset.testid = 'dee-chat-close';
  closeBtn.setAttribute('aria-keyshortcuts', 'Escape');
  closeBtn.append('Close', keycap('esc'));
  closeBtn.addEventListener('click', () => close());
  if (opts.character) head.append(mark);
  head.append(titles, settings, closeBtn);

  // ── thread ──
  const thread = document.createElement('ol');
  thread.className = 'dee-thread dee-chat-thread';
  thread.dataset.testid = 'dee-chat-thread';
  thread.setAttribute('aria-label', 'Conversation');

  // ── suggestions and the field ──
  const suggest = document.createElement('div');
  suggest.className = 'dee-chat-suggest';
  suggest.setAttribute('aria-label', 'Suggested questions');
  suggest.setAttribute('role', 'group');

  const form = document.createElement('form');
  form.className = 'dee-chat-ask';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dee-chat-input';
  input.dataset.testid = 'dee-chat-input';
  input.maxLength = MAX_QUESTION_CHARS + 60;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Ask about the hand, the price, a term or a rule';
  input.setAttribute('aria-label', `Ask ${speaker}`);
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'pill primary';
  send.dataset.testid = 'dee-chat-send';
  send.setAttribute('aria-keyshortcuts', 'Enter');
  send.append('Ask', keycap('↩'));
  form.append(input, send);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q === '' || sheet.dataset.thinking === 'true') return;
    input.value = '';
    void ask(q);
  });

  const announcer = document.createElement('div');
  announcer.className = 'visually-hidden';
  announcer.dataset.testid = 'dee-chat-announcer';
  announcer.setAttribute('aria-live', 'polite');

  sheet.append(head, thread, suggest, form, announcer);
  root.append(scrim, sheet);

  function paintSuggestions(): void {
    suggest.replaceChildren(
      ...suggestionsFor(opts.context()).map((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pill quiet sm dee-chat-chip';
        b.dataset.testid = 'dee-chat-suggestion';
        b.textContent = s.label;
        b.addEventListener('click', () => {
          if (sheet.dataset.thinking !== 'true') void ask(s.question);
        });
        return b;
      }),
    );
  }

  function turn(from: 'dee' | 'you', text: string): HTMLLIElement {
    const li = document.createElement('li');
    li.className = `dee-turn from-${from}`;
    li.dataset.testid = from === 'dee' ? 'dee-chat-dee' : 'dee-chat-you';
    const body = document.createElement('div');
    body.className = 'dee-turn-body';
    const who = document.createElement('span');
    who.className = 'g-label dee-who';
    who.textContent = from === 'dee' ? speaker : 'You';
    const say = document.createElement('p');
    say.className = 'dee-say';
    say.textContent = text;
    body.append(who, say);
    li.append(body);
    thread.append(li);
    thread.scrollTop = thread.scrollHeight;
    return li;
  }

  function pose(p: DeePose): void {
    if (opts.character) setDeePose(mark, p);
  }

  /** The rewording, if a model is installed and answers inside the budget; else the scripted text. */
  async function phrased(a: ChatAnswer): Promise<{ text: string; source: 'model' | 'script' }> {
    if (!a.phrase || opts.phrase === undefined) return { text: a.text, source: 'script' };
    const timeout = sleep(MAX_WAIT_MS).then(() => null);
    const reply = (await Promise.race([opts.phrase({ templateId: a.templateId, slots: a.slots }).catch(() => null), timeout])) as {
      text?: unknown;
      source?: unknown;
    } | null;
    if (reply && reply.source === 'model' && typeof reply.text === 'string' && reply.text.trim() !== '') return { text: reply.text, source: 'model' };
    return { text: a.text, source: 'script' };
  }

  async function ask(question: string): Promise<void> {
    turn('you', question.slice(0, MAX_QUESTION_CHARS + 60));
    sheet.dataset.thinking = 'true';
    send.disabled = true;
    pose('thinking');
    opts.onPerch?.('thinking');
    const started = performance.now();
    const answer = answerQuestion(question, opts.context());
    const words = await phrased(answer);
    const left = MIN_THINK_MS - (performance.now() - started);
    if (left > 0) await sleep(left);
    if (!root.isConnected) return;
    const li = turn('dee', words.text);
    li.dataset.template = answer.templateId;
    li.dataset.kind = answer.kind;
    li.dataset.source = words.source;
    if (opts.character) li.prepend(renderDee(answer.pose, 28));
    announcer.textContent = `${speaker}: ${words.text}`;
    sheet.dataset.thinking = 'false';
    send.disabled = false;
    pose(answer.pose);
    opts.onPerch?.(null);
    paintSuggestions();
    input.focus();
  }

  function onKey(e: KeyboardEvent): void {
    // While the sheet is open no key reaches the screen behind it: typing "call" must never press Call.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    // Focus stays inside the sheet while it is open.
    const focusables = [...sheet.querySelectorAll<HTMLElement>('button:not(:disabled), input')].filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  window.addEventListener('keydown', onKey, true);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    opts.onPerch?.(null);
    root.remove();
    if (opener?.isConnected) opener.focus();
    opts.onClose();
  }

  const greet = chatTemplate('greet');
  const hello = turn('dee', greet?.text ?? '');
  hello.dataset.template = 'greet';
  if (opts.character) hello.prepend(renderDee('listening', 28));
  paintSuggestions();
  opts.warm?.();
  queueMicrotask(() => input.focus());

  return { root, ask, close };
}
