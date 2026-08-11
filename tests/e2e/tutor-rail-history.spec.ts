import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';

/**
 * PHASE 2 — the tutor rail as a BOUNDED multi-turn conversation.
 *
 * Run with NO CREDENTIALS, like tutor-rail.spec.ts: resolveTutor sees no
 * OFFSUIT_BEDROCK_* vars, so nullModelClient answers and every assertion is
 * offline and deterministic. No live Bedrock call is made here.
 *
 * These tests inspect the OUTGOING `history` field — the thing no assertion on
 * rendered text can see — through the same recording transport tutor-rail.spec.ts
 * uses (delegating to the real window.offsuit so the answer still comes from main).
 *
 * The load-bearing tests are the eviction bound (history never exceeds the window,
 * oldest first out) and the anchor reset (committing or moving lesson drops the
 * prior conversation). Both go red under the obvious mutation.
 */

const learnTab = '[data-testid="tab-learn"]';
const playTab = '[data-testid="tab-play"]';
const lessonScreen = '[data-testid="lesson-screen"]';
const lessonRow = '[data-testid="lesson-row"]';
const rail = '[data-testid="tutor-rail"]';
const input = '[data-testid="tutor-input"]';
const sendBtn = '[data-testid="tutor-send"]';
const answer = '[data-testid="tutor-answer"]';

interface RealBridge {
  tutorStatus(): Promise<unknown>;
  askTutor(input: unknown): Promise<unknown>;
}

interface SentPayload {
  context: string;
  question: string;
  history?: { question: string; answerText: string }[];
}

async function openLesson(page: Page, id = 'pot-odds-as-a-price'): Promise<void> {
  await page.locator(learnTab).click();
  await page.locator(lessonScreen).waitFor();
  await page.locator(`${lessonRow}[data-lesson-id="${id}"]`).click();
  await expect(page.locator(lessonScreen)).toHaveAttribute('data-lesson-id', id);
}

/** Install a transport that records every payload sent, then delegates to real IPC. */
async function recordSends(page: Page): Promise<void> {
  await page.evaluate(() => {
    const real = (window as unknown as { offsuit: RealBridge }).offsuit;
    const sent: unknown[] = [];
    Object.assign(window, {
      __offsuitSent: sent,
      __offsuitTutorTransport: {
        tutorStatus: () => real.tutorStatus(),
        askTutor: (payload: unknown) => {
          sent.push(payload);
          return real.askTutor(payload);
        },
      },
    });
  });
}

async function askAndSettle(page: Page, question: string): Promise<void> {
  await page.locator(input).fill(question);
  await page.locator(sendBtn).click();
  await expect(page.locator(rail)).toHaveAttribute('data-pending', '0');
}

async function sentPayloads(page: Page): Promise<SentPayload[]> {
  return page.evaluate(
    () => (window as unknown as { __offsuitSent: SentPayload[] }).__offsuitSent,
  );
}

test.describe('the tutor rail carries bounded conversation history', () => {
  test('1. turn 0 sends no history; each later turn carries the prior answered exchanges', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await openLesson(page);
      await recordSends(page);
      await page.locator(playTab).click();
      await openLesson(page);

      await askAndSettle(page, 'what does check mean');
      await askAndSettle(page, 'who acts first on the flop');
      await askAndSettle(page, 'which hand beats a flush');

      const sent = await sentPayloads(page);
      expect(sent).toHaveLength(3);

      // Turn 0: no history at all — the payload is exactly the single-shot shape.
      expect(sent[0].history).toBeUndefined();
      expect(Object.keys(sent[0]).sort()).toEqual(['context', 'question', 'table']);

      // Turn 1: the one prior answered exchange, question + its answer.
      expect(sent[1].history).toHaveLength(1);
      expect(sent[1].history?.[0].question).toBe('what does check mean');
      expect((sent[1].history?.[0].answerText ?? '').length).toBeGreaterThan(0);

      // Turn 2: both prior exchanges, oldest first.
      expect(sent[2].history?.map((h) => h.question)).toEqual([
        'what does check mean',
        'who acts first on the flop',
      ]);
    } finally {
      await close().catch(() => {});
    }
  });

  test('2. history is bounded — the oldest exchange is evicted past the window', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await openLesson(page);
      await recordSends(page);
      await page.locator(playTab).click();
      await openLesson(page);

      // Six mechanics questions in one spot. Every one is answered, so every one
      // enters the window — which must still never exceed the cap.
      const questions = [
        'what does check mean',
        'who acts first on the flop',
        'which hand beats a flush',
        'what does the button do',
        'what is the minimum raise',
        'what is a side pot',
      ];
      for (const q of questions) await askAndSettle(page, q);

      const sent = await sentPayloads(page);
      expect(sent).toHaveLength(6);

      // The window never grows past the cap, and it is oldest-first.
      const CAP = 3;
      for (const payload of sent) {
        expect((payload.history ?? []).length).toBeLessThanOrEqual(CAP);
      }

      // The LAST send (the 6th question) carries the three MOST RECENT prior
      // exchanges (the 3rd, 4th and 5th), and the first two have been evicted — the
      // bound actually drops old context rather than merely truncating on the wire.
      const lastHistory = sent[sent.length - 1].history ?? [];
      expect(lastHistory.map((h) => h.question)).toEqual([
        'which hand beats a flush',
        'what does the button do',
        'what is the minimum raise',
      ]);
      expect(lastHistory.map((h) => h.question)).not.toContain('what does check mean');
      expect(lastHistory.map((h) => h.question)).not.toContain('who acts first on the flop');
    } finally {
      await close().catch(() => {});
    }
  });

  test('3. a blocked strategy follow-up is not remembered, and the next turn still routes cleanly', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await openLesson(page);
      await recordSends(page);
      await page.locator(playTab).click();
      await openLesson(page);

      await askAndSettle(page, 'what does check mean'); // answered → remembered
      await askAndSettle(page, 'should I call here'); // strategy pre-commit → blocked
      await expect(page.locator(answer).last()).toHaveAttribute('data-state', 'blocked');
      await askAndSettle(page, 'which hand beats a flush'); // answered

      const sent = await sentPayloads(page);
      expect(sent).toHaveLength(3);

      // The blocked question carried the one prior answer as history...
      expect(sent[1].history?.map((h) => h.question)).toEqual(['what does check mean']);
      // ...but was NOT itself remembered: the next turn's history omits it.
      expect(sent[2].history?.map((h) => h.question)).toEqual(['what does check mean']);
      expect(sent[2].history?.map((h) => h.question)).not.toContain('should I call here');
    } finally {
      await close().catch(() => {});
    }
  });

  test('4. committing flips the context AND resets the conversation — no pre-commit talk leaks post-reveal', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await openLesson(page);
      await recordSends(page);
      await page.locator(playTab).click();
      await openLesson(page);

      // Pre-commit conversation.
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-committed', 'false');
      await askAndSettle(page, 'what does check mean');
      await askAndSettle(page, 'who acts first on the flop');

      // Commit — the anchor (context) flips pre→post.
      await page.locator('[data-testid="commit-answer"]').fill('I call, the price is good');
      await page.locator('[data-testid="commit-btn"]').click();
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-committed', 'true');

      // First post-reveal question: fresh conversation, no history from before commit.
      await askAndSettle(page, 'which hand beats a flush');

      const sent = await sentPayloads(page);
      const postReveal = sent.filter((p) => p.context === 'spot-post-reveal');
      expect(postReveal.length).toBeGreaterThan(0);
      // The first post-reveal send starts a new spot: no history carried across the commit.
      expect(postReveal[0].history ?? []).toEqual([]);
      expect(postReveal[0].question).toBe('which hand beats a flush');
    } finally {
      await close().catch(() => {});
    }
  });

  test('5. per-turn provenance still renders under each answer of a multi-turn conversation', async () => {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await openLesson(page);
      await askAndSettle(page, 'what does check mean');
      await askAndSettle(page, 'which hand beats a flush');

      const sources = page.locator('[data-testid="tutor-source"]');
      await expect(sources).toHaveCount(2);
      // Both answers name where they came from — the null tutor's written notes.
      for (let i = 0; i < 2; i += 1) {
        await expect(sources.nth(i)).toContainText('written notes');
      }
    } finally {
      await close().catch(() => {});
    }
  });
});
