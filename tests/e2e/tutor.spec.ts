import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertNoNetwork, launchApp, sel, shot } from './helpers.js';
import { playToShowdown, tableScreen, waitForIdle } from './flow.js';

const homeScreen = '[data-testid="home-screen"]';

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-tutor-'));
}

interface TutorStatus {
  tutorId: string;
  credentialsConfigured: boolean;
  egressAllowlist: string[];
  guardFailures: number;
}

interface AskResult {
  tutorId: string;
  questionKind: 'rules' | 'strategy';
  verdict: 'allowed' | 'blocked';
  text: string | null;
  payloadKeys: string[];
}

const TABLE = {
  positions: ['BTN', 'BB'],
  stacksBb: [97, 88],
  potBb: 11,
  board: ['Kh', 'Td', '4c'],
  heroCards: ['Ah', 'Qs'],
  toAct: 'BTN',
  street: 'flop',
};

const GRADE = {
  tier: 'T3',
  deltaEvBb: 1.73,
  errorTag: 'TEXTURE',
  potBeforeActionBb: 11,
  chosenAction: 'check',
  bestAction: 'bet',
  actionEvsBb: { check: 3.41, bet: 5.14 },
  equityPct: 63,
  principle: 'Nut advantage sets the size',
  boundaryHand: 'AJo',
  flippingVariable: 'one seat of position',
  classRwBbPer100: 2.87,
};

/** Solver digits that must never appear in a pre-commit tutor payload. */
const SOLVER_DIGITS = ['1.73', '3.41', '5.14', '63', '2.87'];

interface TutorBridge {
  tutorStatus(): Promise<TutorStatus>;
  askTutor(input: unknown): Promise<AskResult>;
}

/**
 * Go through the contextBridge from the renderer, so what is asserted is the
 * shipped path: preload → IPC → main. Reaching into ipcMain's private handler
 * map would test a different call than the app makes.
 */
function status(page: Page): Promise<TutorStatus> {
  return page.evaluate(() =>
    (window as unknown as { offsuit: TutorBridge }).offsuit.tutorStatus(),
  );
}

function ask(page: Page, input: unknown): Promise<AskResult> {
  return page.evaluate(
    (payload) => (window as unknown as { offsuit: TutorBridge }).offsuit.askTutor(payload),
    input,
  );
}

test.describe('T1 — no credentials configured', () => {
  test('the tutor is the null tutor, the egress allowlist is empty, and no request is attempted', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      const attempted = await assertNoNetwork(page);
      const failedHttp: string[] = [];
      page.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url())) failedHttp.push(request.url());
      });

      // Reload through the interceptor so an empty list proves silence rather
      // than a dead route handler.
      await page.reload();
      await page.waitForSelector(homeScreen);

      const before = await status(page);
      expect(before.credentialsConfigured).toBe(false);
      expect(before.tutorId).toBe('null');
      expect(before.egressAllowlist).toEqual([]);

      // Exercise the tutor across every context that admits a question, then a
      // full hand, and assert the network stayed silent throughout.
      const contexts = [
        'spot-pre-commit',
        'spot-post-reveal',
        'assessment',
        'table-ungraded',
        'table-whole-task',
        'dossier-progress',
        'plm-drill',
      ] as const;
      for (const context of contexts) {
        await ask(page, { context, question: 'what does check mean', table: TABLE });
        await ask(page, { context, question: 'should I bet here', table: TABLE, grade: GRADE });
      }

      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      await playToShowdown(page);

      expect(attempted).toEqual([]);
      expect(failedHttp).toEqual([]);
      expect((await status(page)).guardFailures).toBe(0);
    } finally {
      await close();
    }
  });

  test('the fixed string table still answers — the app is functional, not merely silent', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);

      const rules = await ask(page, {
        context: 'spot-pre-commit',
        question: 'which hand beats a flush',
        table: TABLE,
      });
      expect(rules.verdict).toBe('allowed');
      expect(rules.questionKind).toBe('rules');
      expect(rules.text).not.toBe(null);
      expect((rules.text ?? '').length).toBeGreaterThan(20);

      const correction = await ask(page, {
        context: 'spot-post-reveal',
        question: 'explain the miss',
        table: TABLE,
        grade: GRADE,
      });
      expect(correction.text).toContain('Nut advantage sets the size');
      expect(correction.text).toContain('AJo');
      // G6: three chunks, ≤60 words.
      expect((correction.text ?? '').trim().split(/\s+/).length).toBeLessThanOrEqual(60);
    } finally {
      await close();
    }
  });
});

test.describe('T3a — assert on the real IPC payload, both paths', () => {
  test('the pre-commit rules payload carries no solver field and no solver numeral', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);
      const result = await ask(page, {
        context: 'spot-pre-commit',
        question: 'what does check mean',
        table: TABLE,
      });

      expect(result.verdict).toBe('allowed');
      // No key path under `grade.` exists, and none of the solver names appear.
      expect(result.payloadKeys.filter((k) => k.startsWith('grade'))).toEqual([]);
      for (const forbidden of ['deltaEvBb', 'actionEvsBb', 'bestAction', 'equityPct', 'tier']) {
        expect(result.payloadKeys.some((k) => k.includes(forbidden))).toBe(false);
      }
      // The visible table IS present — the learner can already see it.
      expect(result.payloadKeys).toContain('table.potBb');
      expect(result.payloadKeys).toContain('question');
    } finally {
      await close();
    }
  });

  test('passing a grade pre-commit does not smuggle it through — the matrix blocks first', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);
      const result = await ask(page, {
        context: 'spot-pre-commit',
        question: 'should I bet here',
        table: TABLE,
        grade: GRADE,
      });
      expect(result.verdict).toBe('blocked');
      expect(result.questionKind).toBe('strategy');
      expect(result.text).toBe(null);
      expect(result.payloadKeys).toEqual([]);
    } finally {
      await close();
    }
  });

  test('the post-reveal payload DOES carry the numbers — the split is real, not vacuous', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);
      const result = await ask(page, {
        context: 'spot-post-reveal',
        question: 'explain the miss',
        table: TABLE,
        grade: GRADE,
      });
      expect(result.verdict).toBe('allowed');
      expect(result.payloadKeys).toContain('grade.deltaEvBb');
      expect(result.payloadKeys).toContain('grade.actionEvsBb.bet');
      expect(result.payloadKeys).toContain('grade.equityPct');
    } finally {
      await close();
    }
  });

  test('no answer text ever quotes a solver numeral on a pre-commit rules question', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);
      for (const question of [
        'what does check mean',
        'who acts first on the flop',
        'what is the minimum raise',
      ]) {
        const result = await ask(page, { context: 'spot-pre-commit', question, table: TABLE });
        for (const digits of SOLVER_DIGITS) {
          expect(result.text ?? '', `"${question}" leaked ${digits}`).not.toContain(digits);
        }
      }
    } finally {
      await close();
    }
  });
});

test.describe('T5 — the mute matrix over the real IPC channel', () => {
  const cases: readonly [string, string, 'allowed' | 'blocked', boolean][] = [
    ['plm-drill', 'what does check mean', 'blocked', false],
    ['plm-drill', 'should I bet', 'blocked', false],
    ['spot-pre-commit', 'what does check mean', 'allowed', true],
    ['spot-pre-commit', 'should I bet', 'blocked', false],
    ['assessment', 'which hand beats a flush', 'allowed', true],
    ['assessment', 'what is my equity', 'blocked', false],
    ['table-ungraded', 'how wide is their range', 'allowed', true],
    ['table-whole-task', 'what is the minimum raise', 'allowed', true],
    ['table-whole-task', 'is calling correct', 'blocked', false],
    ['dossier-progress', 'what is the best action', 'allowed', true],
  ];

  test('every asserted cell behaves in the shipped app', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);
      for (const [context, question, verdict, answered] of cases) {
        const result = await ask(page, { context, question, table: TABLE, grade: GRADE });
        expect(result.verdict, `${context} + "${question}"`).toBe(verdict);
        expect(result.text !== null, `${context} + "${question}" answered?`).toBe(answered);
      }
    } finally {
      await close();
    }
  });
});

test.describe('screenshots', () => {
  test('the table still renders with the tutor IPC wired in', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);
      await shot(page, 'tutor-foundation-home');
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      await waitForIdle(page);
      await expect(page.locator(`${sel.heroCards} ${sel.card}`)).toHaveCount(2);
      await shot(page, 'tutor-foundation-table');
    } finally {
      await close();
    }
  });
});
