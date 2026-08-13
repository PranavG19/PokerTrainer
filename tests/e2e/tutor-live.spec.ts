import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * OFFSUIT_LIVE_E2E — the ONE test that actually calls Bedrock.
 *
 * OPT-IN AND OFF BY DEFAULT. This whole file skips unless OFFSUIT_LIVE_E2E=1 is set in the
 * environment, so default CI never opens a socket and the hermetic guarantee of every other spec is
 * untouched. It exists to prove the round-trip the offline suite cannot: a real model completion
 * travelling the full stack — renderer rail → tutor:ask IPC → askTutor → runTutorAgent →
 * bedrock.converse() → guard → rendered answer — and being RECORDED into the multi-turn replay cache
 * so a later hermetic run can replay it.
 *
 * WHY IT IS SAFE TO LEAVE IN THE TREE. With the flag unset the test body never runs (test.skip fires
 * before any launch), so it costs nothing and cannot fire a paid API call by accident. A developer
 * with credentials runs it deliberately:
 *
 *   OFFSUIT_LIVE_E2E=1 \
 *   OFFSUIT_BEDROCK_PROFILE=<profile> \
 *   OFFSUIT_BEDROCK_REGION=us-west-2 \
 *   OFFSUIT_BEDROCK_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0 \
 *   npx playwright test tests/e2e/tutor-live.spec.ts
 *
 * The run launches in OFFSUIT_REPLAY_MODE=record with a fresh fixture dir, so every model turn is
 * written to a `${envelopeHash}.turn.json` file. Those fixtures are what a future hermetic replay
 * spec loads (mode=replay), exactly as settings.spec.ts already does for the single-shot path via
 * seedReplay(promptHash) — this is the multi-turn analogue, keyed by envelopeHash.
 *
 * The privacy guard is NOT relaxed for a live run: bedrock.converse() output is checked per turn by
 * the same guardToolResult / textPasses the offline agent uses, so a live model that emitted a
 * fabricated numeral would be regenerated or fall to the fixed table exactly as the mock does.
 */

const LIVE = process.env.OFFSUIT_LIVE_E2E === '1';

const learnTab = '[data-testid="tab-learn"]';
const lessonScreen = '[data-testid="lesson-screen"]';
const lessonRow = '[data-testid="lesson-row"]';
const rail = '[data-testid="tutor-rail"]';
const input = '[data-testid="tutor-input"]';
const sendBtn = '[data-testid="tutor-send"]';
const answer = '[data-testid="tutor-answer"]';
const body = '[data-testid="tutor-turn-body"]';

async function openLesson(page: Page, id = 'pot-odds-as-a-price'): Promise<void> {
  await page.locator(learnTab).click();
  await page.locator(lessonScreen).waitFor();
  await page.locator(`${lessonRow}[data-lesson-id="${id}"]`).click();
  await expect(page.locator(lessonScreen)).toHaveAttribute('data-lesson-id', id);
}

async function askAndSettle(page: Page, question: string): Promise<void> {
  await page.locator(input).fill(question);
  await page.locator(sendBtn).click();
  // A live Bedrock call is ~2-5s; allow generous headroom before the rail settles.
  await expect(page.locator(rail)).toHaveAttribute('data-pending', '0', { timeout: 30_000 });
}

test.describe('the live Bedrock round-trip (opt-in, records replay fixtures)', () => {
  test.skip(
    !LIVE,
    'OFFSUIT_LIVE_E2E is not set — this is the only spec that calls the real model, and it stays off in CI',
  );

  test('a multi-turn follow-up is answered by the model and recorded to the turn cache', async () => {
    // A real credential set MUST be present for a live run; fail loudly rather than silently
    // resolving to the null tutor (which would make the assertions pass without a model).
    for (const key of ['OFFSUIT_BEDROCK_PROFILE', 'OFFSUIT_BEDROCK_REGION', 'OFFSUIT_BEDROCK_MODEL']) {
      expect(process.env[key], `${key} must be set for a live run`).toBeTruthy();
    }

    const replayDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-live-fixtures-'));
    const { app, page, close } = await launchApp({
      seed: 42,
      env: {
        // record mode: every model turn is written to replayDir as a fixture.
        OFFSUIT_REPLAY_MODE: 'record',
        OFFSUIT_REPLAY_DIR: replayDir,
      },
    });
    try {
      void app;
      await openLesson(page);
      // Credentials are set, so the rail reports a live tutor (not the null one).
      await expect(page.locator(rail)).toHaveAttribute('data-tutor', 'live');

      // Turn 0: a plain mechanics question. No history yet, so this rides the single-shot path.
      await askAndSettle(page, 'what does check mean');
      // Turn 1: a FOLLOW-UP. The rail now sends history, which routes askTutor to runTutorAgent —
      // the multi-turn agent path, which is the thing this file exists to exercise live.
      await askAndSettle(page, 'and who acts first after the flop');

      const latest = page.locator(answer).last();
      await expect(latest).toHaveAttribute('data-state', 'answered');
      // The follow-up produced a non-empty rendered answer through the whole stack.
      const answered = (await latest.locator(body).textContent()) ?? '';
      expect(answered.trim().length, 'the live follow-up rendered no text').toBeGreaterThan(0);

      // The multi-turn cache recorded at least one turn fixture — the artefact a hermetic replay
      // spec will load. A single-shot `.json` may also be present from turn 0; we assert the
      // multi-turn `.turn.json` specifically, since that is the path this file proves.
      const fixtures = fs.readdirSync(replayDir);
      const turnFixtures = fixtures.filter((f) => f.endsWith('.turn.json'));
      expect(turnFixtures.length, `no .turn.json fixture written; dir had: ${fixtures.join(', ')}`).toBeGreaterThan(0);

      // A recorded turn is a well-formed ModelTurn (text or tool_use) — not an empty/garbage file.
      const oneTurn = JSON.parse(fs.readFileSync(path.join(replayDir, turnFixtures[0]), 'utf-8')) as {
        turn?: { kind?: string };
      };
      expect(['text', 'tool_use']).toContain(oneTurn.turn?.kind);
    } finally {
      await close().catch(() => {});
      fs.rmSync(replayDir, { recursive: true, force: true });
    }
  });
});
