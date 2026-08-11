/**
 * THE TUTOR RAIL — the tutor as back-and-forth chat, over the real tutor:ask IPC.
 *
 * Three things this component deliberately does NOT do, because each would break a guarantee that
 * lives in src/main/tutor and has tests of its own:
 *
 *  1. IT DOES NOT CLASSIFY, AND IT DOES NOT DECIDE. The mute matrix (src/main/tutor/muteMatrix.ts)
 *     classifies rules-vs-strategy and looks the verdict up in T5, in MAIN. The rail sends the
 *     context and the question and renders what comes back. There is no keyword list here, no
 *     local copy of T5, and no local answer text for a question the matrix refused — so a
 *     pre-commit strategy question has nothing in this file that could answer it.
 *
 *  2. IT NEVER SENDS A GRADE. Lesson mode has no grader, so there is no GradePayload to send and
 *     none is constructed. askTutor()'s builder selection is `grade === undefined ? rules :
 *     strategy`, so every payload this rail produces is a RulesRequest, which has no field that
 *     can carry ΔEV, an action EV, a best action or equity (T3a).
 *
 *  3. IT NEVER CLAIMS A MODEL IT DOES NOT HAVE. Provenance is repeated on every single answer and
 *     comes from `answeredBy`, which main reports per answer — not from a flag this component set
 *     at mount, and not inferred from `tutorId`. That distinction is load-bearing: liveTutor falls
 *     back to the written notes silently whenever the model fails, times out or is guard-rejected,
 *     so a configured model is NOT evidence the model answered. There is no state in which the rail
 *     is silent about, or wrong about, where an answer came from.
 *
 * ASYNC. Each question appends its own learner turn and its own tutor turn immediately; the tutor
 * turn sits in `pending` until its own answer lands. Nothing is disabled while a call is in flight
 * and no second question is refused, so a ~2.5s Bedrock call cannot freeze the surface. Answers are
 * written into the turn that asked for them, so an answer arriving late lands on its own question
 * rather than under a newer one.
 */

/**
 * The wire shapes, declared rather than imported.
 *
 * src/main/tutor/types.ts states that those types never cross into the renderer, and the preload
 * bridge is typed `(input: unknown) => Promise<unknown>` on purpose. What the renderer needs is the
 * IPC contract, which is narrower than the main-process types: this rail sends a context, a
 * question and the visible table, and reads back four fields. tests/e2e/tutor-rail.spec.ts asserts
 * the payload the rail actually sends, so a drift between these declarations and main's types
 * fails a test rather than passing silently.
 */
export type RailContext =
  | 'plm-drill'
  | 'spot-pre-commit'
  | 'spot-post-reveal'
  | 'assessment'
  | 'table-ungraded'
  | 'table-whole-task'
  | 'dossier-progress';

/** Mirrors VisibleTable: what the learner can already see. Carries no solver quantity. */
export interface RailTable {
  readonly positions: readonly string[];
  readonly stacksBb: readonly number[];
  readonly potBb: number;
  readonly board: readonly string[];
  readonly heroCards: readonly string[];
  readonly toAct: string;
  readonly street: 'preflop' | 'flop' | 'turn' | 'river';
}

interface AskResult {
  readonly tutorId: string;
  readonly questionKind: 'rules' | 'strategy';
  readonly verdict: 'allowed' | 'blocked';
  readonly text: string | null;
  /**
   * What actually produced the text. `fixed` covers every route to the written
   * notes — no credentials, a model that failed or timed out, and a guard
   * rejection — so provenance is read rather than inferred from `tutorId`.
   */
  readonly answeredBy: 'fixed' | 'model' | null;
}

interface TutorStatus {
  readonly tutorId: string;
  readonly credentialsConfigured: boolean;
}

interface TutorBridge {
  tutorStatus(): Promise<unknown>;
  askTutor(input: unknown): Promise<unknown>;
}

export interface TutorRailOptions {
  /**
   * Read at send time, never cached: the mute matrix cell that applies is the one for the context
   * the learner is in WHEN THEY ASK. A context captured at mount would let a question asked
   * pre-commit be judged by the post-reveal row after the learner commits.
   */
  readonly context: () => RailContext;
  readonly table: () => RailTable;
}

/**
 * A real Bedrock call is ~2.5s. This bound is what turns "unreachable" into a visible answer
 * instead of a rail that pends forever — the main-side client has its own retry, so by the time
 * this fires the call is not coming back.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

declare global {
  interface Window {
    /**
     * e2e seam, same pattern as __offsuitLessonsStub in screens/lesson.ts. The timeout branch is
     * only reachable by waiting, and a test that waits 20s is a test nobody runs; a test that
     * sleeps at all is forbidden. Overriding the bound is the only way to assert the branch
     * against the shipped code path rather than a copy of it.
     */
    __offsuitTutorTimeoutMs?: number;
    /**
     * e2e seam for the failure branches, and the ONLY one — every non-failure assertion goes
     * through window.offsuit and the real IPC.
     *
     * It exists because contextBridge freezes `window.offsuit`: it is non-configurable and
     * non-writable, so a test cannot wrap the transport from outside, and the alternatives are all
     * worse. A working main process cannot be made to hang (timeout), and the only way to make the
     * real handler reject is to send it a malformed context — which a test CAN do through this
     * seam by delegating to window.offsuit, so "unreachable" is asserted against a genuine
     * main-process rejection over the real channel rather than a fabricated one.
     *
     * Nothing in the app sets it. Absent — which is every shipped run — tutorBridge() reads
     * window.offsuit and this branch is dead code.
     */
    __offsuitTutorTransport?: Partial<TutorBridge>;
  }
}

type TurnState = 'pending' | 'answered' | 'blocked' | 'failed' | 'timeout';

export function renderTutorRail(options: TutorRailOptions): HTMLElement {
  const root = document.createElement('div');
  root.className = 'tutor-rail';
  root.dataset.testid = 'tutor-rail';
  root.dataset.state = 'idle';
  /** 'unknown' until tutor:status answers. It is never optimistically 'live'. */
  root.dataset.tutor = 'unknown';
  root.dataset.pending = '0';

  const heading = document.createElement('div');
  heading.className = 'tutor-rail-heading';
  heading.appendChild(text('div', 'tutor-rail-title', 'Ask the tutor'));

  const provenance = text(
    'div',
    'tutor-rail-provenance',
    'Checking what is answering here…',
  );
  provenance.dataset.testid = 'tutor-provenance';
  heading.appendChild(provenance);
  root.appendChild(heading);

  const transcript = document.createElement('div');
  transcript.className = 'tutor-transcript';
  transcript.dataset.testid = 'tutor-transcript';
  root.appendChild(transcript);

  const empty = text(
    'div',
    'tutor-rail-empty',
    'Nothing asked yet. Mechanics questions are answered here — what an action does, who acts first, which hand beats which.',
  );
  empty.dataset.testid = 'tutor-empty';
  transcript.appendChild(empty);

  const box = document.createElement('textarea');
  box.className = 'lesson-input';
  box.dataset.testid = 'tutor-input';
  box.rows = 2;
  box.placeholder = 'Ask about the mechanics of this position';

  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'pill';
  send.dataset.testid = 'tutor-send';
  send.textContent = 'Ask';
  send.disabled = true;
  box.addEventListener('input', () => {
    send.disabled = box.value.trim() === '';
  });

  const composer = document.createElement('div');
  composer.className = 'tutor-composer';
  composer.appendChild(box);
  composer.appendChild(send);
  root.appendChild(composer);

  let pending = 0;

  /**
   * BOUNDED MULTI-TURN MEMORY. The last few ANSWERED exchanges in the current spot,
   * oldest first, sent as `history` so the tutor agent in main can read what was
   * already said. Two bounds keep it "within reason":
   *
   *  1. WINDOW — at most HISTORY_CAP pairs are ever sent. Older ones are evicted, so
   *     the payload cannot grow without limit however long the learner talks. This
   *     is the cap; there is no separate composer lock, because a learner asking one
   *     more mechanics question is not something to forbid.
   *  2. ANCHOR — the memory belongs to ONE spot, keyed by the context+table read at
   *     send time. Moving to another lesson, or committing (which flips the context
   *     pre→post), changes the anchor and the conversation starts fresh. A prior
   *     spot's exchanges never travel to a new one.
   *
   * Only 'answered' turns are remembered: a refusal or a failure carries no answer
   * worth threading, and remembering a blocked strategy question would be pointless
   * context. History is threaded into the agent's transcript in main, never into the
   * guarded request — the privacy check's allowed numerals come from the current
   * turn alone, so nothing here can widen them.
   */
  const HISTORY_CAP = 3;
  const history: { question: string; answerText: string }[] = [];
  let historyAnchor: string | null = null;

  /** The spot identity: same position AND same T5 row. A change resets the memory. */
  const anchorFor = (context: RailContext, table: RailTable): string =>
    JSON.stringify({ context, table });

  const republish = (last: TurnState | null): void => {
    root.dataset.pending = String(pending);
    root.dataset.state = pending > 0 ? 'pending' : (last ?? 'idle');
  };

  /**
   * Keep the box that takes the NEXT question on screen.
   *
   * Called on send and again on every settle, because an answer lands asynchronously and growing the
   * transcript moves the composer down after the send-time scroll has already happened — scrolling
   * only on send left the input below the fold once the reply arrived. The whole composer is the
   * target, not the textarea: scrolling the textarea into view left the Ask button under the edge.
   */
  const keepComposerVisible = (): void => {
    transcript.scrollTop = transcript.scrollHeight;
    composer.scrollIntoView({ block: 'nearest' });
  };

  const ask = (): void => {
    const question = box.value.trim();
    if (question === '') return;

    empty.remove();
    box.value = '';
    send.disabled = true;

    const turn = appendTurn(transcript, question);
    pending += 1;
    republish(null);

    keepComposerVisible();

    void resolveTurn(turn, question, options).then((state) => {
      pending -= 1;
      republish(state);
      keepComposerVisible();
    });
  };

  send.addEventListener('click', ask);
  /**
   * Enter sends, Shift+Enter writes a newline. The lesson screen's own keydown handler ignores
   * events from a textarea, so nothing here has to fight it for the key.
   */
  box.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    ask();
  });

  void loadStatus().then((status) => {
    if (status === null) {
      root.dataset.tutor = 'absent';
      provenance.textContent =
        'No tutor is reachable in this build, so nothing can be asked and nothing is sent anywhere.';
      return;
    }
    root.dataset.tutor = status.credentialsConfigured ? 'live' : 'null';
    provenance.textContent = status.credentialsConfigured
      ? `A model is configured (${status.tutorId}). A question goes to it and takes a couple of seconds to come back.`
      : 'No model is configured, so nothing leaves this machine. Answers here come from a fixed set of written notes, and they say so under every reply.';
  });

  /** Resolves to the outcome so the caller can publish it after decrementing the pending count. */
  async function resolveTurn(
    turn: Turn,
    question: string,
    opts: TutorRailOptions,
  ): Promise<TurnState> {
    const bridge = tutorBridge();
    if (bridge === null) {
      return settle(turn, 'failed', {
        body: 'Nothing answered: this build has no tutor attached, so the question was not sent anywhere.',
        source: 'No model, and no fixed notes either — nothing was reached.',
      });
    }

    const context = opts.context();
    const table = opts.table();

    // Anchor check at SEND time: a new spot (moved lesson, or committed and the
    // context flipped) drops the prior conversation before this question is sent,
    // so no earlier spot's exchanges travel into it.
    const anchor = anchorFor(context, table);
    if (anchor !== historyAnchor) {
      historyAnchor = anchor;
      history.length = 0;
    }

    // Snapshot the window to send. Empty on turn 0, so that payload stays exactly
    // {context, question, table} and the single-shot path in main is unchanged.
    const sentHistory = history.map((pair) => ({ ...pair }));
    const outcome = await attemptAsk(bridge, {
      context,
      question,
      table,
      ...(sentHistory.length > 0 ? { history: sentHistory } : {}),
    });

    if (outcome.kind === 'timeout') {
      return settle(turn, 'timeout', {
        body: 'No answer came back in time, so the question was dropped rather than left hanging. The lesson above is unaffected — ask again whenever you like.',
        source: 'Nothing was written: the request timed out.',
      });
    }
    if (outcome.kind === 'unreachable') {
      return settle(turn, 'failed', {
        body: 'The tutor could not be reached, so nothing was answered. The lesson above is unaffected — ask again whenever you like.',
        source: 'Nothing was written: the tutor did not respond.',
      });
    }

    const result = outcome.result;
    if (result.verdict === 'blocked') {
      return settle(turn, 'blocked', {
        body: blockedNotice(result.questionKind, context),
        source: 'Nothing was sent to a model and nothing was answered — the question was held back here.',
      });
    }
    if (result.text === null || result.text.trim() === '') {
      return settle(turn, 'failed', {
        body: 'The question was allowed through but came back with nothing written in it, so there is nothing to show. Ask again, or ask it a different way.',
        source: 'Nothing was written.',
      });
    }

    // Remember this exchange for the next follow-up, evicting the oldest past the
    // window. Only answered turns are kept — a refusal or failure carries no answer.
    history.push({ question, answerText: result.text });
    while (history.length > HISTORY_CAP) history.shift();

    return settle(turn, 'answered', {
      body: result.text,
      source: answerSource(result),
    });
  }

  /**
   * Where THIS answer came from, read from what main reported rather than inferred.
   *
   * `answeredBy` is the only trustworthy signal: liveTutor falls back to the written notes silently
   * whenever the model fails, times out or is guard-rejected, so a configured model is not evidence
   * that the model answered. Inferring from `tutorId` alone told the learner "From the configured
   * model" while the fixed notes were what actually answered — which is exactly the claim the rail
   * must never make. A guard rejection is still reported as what the learner can observe, with no
   * check name, no violation list and no raw output.
   */
  function answerSource(result: AskResult): string {
    if (result.answeredBy === 'model') return 'From the configured model.';

    // The written notes answered. Which route got here is what the learner is told next.
    if (result.tutorId === 'null') return 'From the written notes — no model is configured.';
    return 'From the written notes: the configured model did not supply a usable answer.';
  }

  return root;
}

interface Turn {
  readonly answer: HTMLElement;
  readonly body: HTMLElement;
  readonly source: HTMLElement;
}

function appendTurn(transcript: HTMLElement, question: string): Turn {
  const asked = document.createElement('div');
  asked.className = 'tutor-turn';
  asked.dataset.testid = 'tutor-turn';
  asked.dataset.role = 'learner';
  asked.appendChild(text('div', 'tutor-turn-body', question));
  transcript.appendChild(asked);

  const answer = document.createElement('div');
  answer.className = 'tutor-turn';
  answer.dataset.testid = 'tutor-answer';
  answer.dataset.role = 'tutor';
  answer.dataset.state = 'pending';

  const body = text('div', 'tutor-turn-body', 'Working on the answer…');
  body.dataset.testid = 'tutor-turn-body';
  answer.appendChild(body);

  const source = text('div', 'tutor-turn-source', 'Nothing written yet.');
  source.dataset.testid = 'tutor-source';
  answer.appendChild(source);

  transcript.appendChild(answer);
  return { answer, body, source };
}

function settle(turn: Turn, state: TurnState, copy: { body: string; source: string }): TurnState {
  turn.answer.dataset.state = state;
  turn.body.textContent = copy.body;
  turn.source.textContent = copy.source;
  return state;
}

/**
 * Why a question was held back, in the learner's terms.
 *
 * The wording names the CONTEXT and the KIND the matrix actually decided on, so it is true for
 * whichever cell of T5 refused, and it points at the column that is open rather than leaving the
 * rail looking broken. Nothing here is greyed out or taken away: the same box answers the next
 * question.
 */
function blockedNotice(kind: 'rules' | 'strategy', context: RailContext): string {
  if (context === 'plm-drill') {
    return 'Held back during a drill. Nothing is answered mid-drill, rules or strategy — the rail answers again once the block ends.';
  }
  if (kind === 'strategy') {
    const where =
      context === 'spot-pre-commit'
        ? 'until a decision is committed'
        : 'on this surface';
    return `Held back ${where}: that reads as a question about which play is better, and answering it would hand over the decision this position is asking for. Mechanics questions are still answered — what an action does, who acts first, which hand beats which.`;
  }
  return 'Held back here: this surface answers nothing while it is in progress. The lesson text above is unaffected.';
}

type AskOutcome =
  | { readonly kind: 'ok'; readonly result: AskResult }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'unreachable' };

async function attemptAsk(bridge: TutorBridge, input: unknown): Promise<AskOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AskOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs());
  });

  const call = bridge.askTutor(input).then(
    (raw): AskOutcome => {
      const result = asAskResult(raw);
      return result === null ? { kind: 'unreachable' } : { kind: 'ok', result };
    },
    (): AskOutcome => ({ kind: 'unreachable' }),
  );

  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function timeoutMs(): number {
  const override = window.__offsuitTutorTimeoutMs;
  return typeof override === 'number' && override > 0 ? override : DEFAULT_TIMEOUT_MS;
}

/** No bridge outside Electron (`npm run dev`), and the rail says so rather than pretending. */
function tutorBridge(): TutorBridge | null {
  const bridge =
    window.__offsuitTutorTransport ?? (window as { offsuit?: Partial<TutorBridge> }).offsuit;
  if (!bridge) return null;
  if (typeof bridge.askTutor !== 'function' || typeof bridge.tutorStatus !== 'function') return null;
  return bridge as TutorBridge;
}

async function loadStatus(): Promise<TutorStatus | null> {
  const bridge = tutorBridge();
  if (bridge === null) return null;
  try {
    return asStatus(await bridge.tutorStatus());
  } catch {
    return null;
  }
}

/** The bridge is typed `Promise<unknown>`, so the shape is checked rather than asserted. */
function asAskResult(raw: unknown): AskResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const verdict = value.verdict;
  const kind = value.questionKind;
  if (verdict !== 'allowed' && verdict !== 'blocked') return null;
  if (kind !== 'rules' && kind !== 'strategy') return null;
  if (typeof value.tutorId !== 'string') return null;
  if (value.text !== null && typeof value.text !== 'string') return null;
  const answeredBy = value.answeredBy;
  if (answeredBy !== 'fixed' && answeredBy !== 'model' && answeredBy !== null) return null;
  return { tutorId: value.tutorId, questionKind: kind, verdict, text: value.text, answeredBy };
}

function asStatus(raw: unknown): TutorStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.tutorId !== 'string') return null;
  if (typeof value.credentialsConfigured !== 'boolean') return null;
  return {
    tutorId: value.tutorId,
    credentialsConfigured: value.credentialsConfigured,
  };
}

function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
