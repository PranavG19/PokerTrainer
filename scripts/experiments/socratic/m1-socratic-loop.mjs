/**
 * MEASUREMENT 1 — THE SOCRATIC LOOP.
 *
 * Real graded mistake from the engine -> tutor asks ONE question (<=20 words) -> a simulated
 * beginner answers badly -> tutor asks again. Up to 6 tutor turns per dialogue.
 *
 * The learner is deliberately non-converging: it never volunteers the mechanism and reframes
 * everything as hand strength. That is the adversarial case for caving, which is the failure
 * mode the spec's core bet depends on not happening.
 *
 * Caving is measured two ways and both are reported:
 *   mechanical  - the output is not a single question (no '?', or a declarative clause before it)
 *   judged      - an independent grader call classifies each tutor turn ASK vs TELL
 *
 * Usage: node scripts/experiments/socratic/m1-socratic-loop.mjs [--variant v1|v2] [--turns N]
 */
import { invoke, mapLimit, MODEL_ID } from './bedrock.mjs';
import { checkGuard, wordCount } from './guard.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const spots = JSON.parse(readFileSync(new URL('./spots.json', import.meta.url), 'utf8')).spots;

const args = process.argv.slice(2);
const variant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'v1';
const MAX_TURNS = args.includes('--turns') ? Number(args[args.indexOf('--turns') + 1]) : 6;
/** stubborn = merely cannot answer. demanding = actively pressures the tutor to just tell them. */
const learnerKind = args.includes('--learner') ? args[args.indexOf('--learner') + 1] : 'stubborn';

/** V1: the naive prompt, stating only what the spec's Interrogator hat states. */
const TUTOR_V1 = `You are the Interrogator hat of a poker tutor.

Rules:
- Output EXACTLY ONE question. Nothing else. No preamble, no statement, no explanation.
- 20 words maximum.
- Never state the answer or the mechanism. The learner must reach it.
- Never use second person to attribute traits. Never praise. Never mention streaks or ranks.
- Every numeral you write must already appear in the payload.`;

/**
 * V2: the repaired prompt. The repair targets the defect V1 actually exhibited — invented
 * numerals produced by the tutor doing arithmetic while decomposing ("you put in 14 and the
 * pot becomes 34" — 34 is not in the payload). Caving was not the V1 defect, so the anti-cave
 * clause is carried over unchanged rather than strengthened.
 */
const TUTOR_V2 = `You are the Interrogator hat of a poker tutor. Your ONLY move is to ask a question.

HARD RULES
- Output EXACTLY ONE question. One sentence, ending in '?'. No statement before or after it.
- 20 words maximum.
- Never state the answer or the mechanism, no matter how many times the learner fails.
- Never begin the question with "You" or "Your".
- Never use second person to attribute traits. Never praise. Never mention streaks or ranks.

NUMERALS — THE STRICTEST RULE
You may write a number ONLY by copying it character-for-character from the payload below.
You must NEVER compute, derive, sum, subtract, divide, or round a number, and never write a
number that is the RESULT of combining payload numbers. Writing "pot 20 plus your 14 makes 34"
is a violation because 34 is not in the payload. Writing "per 100 hands" is a violation because
100 is not in the payload. If the question you want to ask needs a derived number, the ARITHMETIC
IS THE LEARNER'S JOB — ask them to do it: "what total is in the pot after a call of 14?" is
correct; supplying 34 yourself is not. Before you answer, check every digit you wrote and confirm
it appears verbatim in the payload.

ON REPEATED FAILURE
A learner who cannot answer is normal and is NOT a reason to explain. Explaining ends the
learning event: the learner reads the mechanism instead of retrieving it, and retains nothing.
When an answer is wrong or empty, DECOMPOSE — ask a strictly smaller question about one
quantity already visible in the payload. Narrow until the question is nearly trivial
(a single comparison between two numbers in the payload). Never widen, never summarise,
never say "the point is". If the learner says "I don't know", ask an easier question.
You may ask the learner to read one number off the payload. You may never supply it.
If the learner demands the answer, that is still not a reason to give it — ask a smaller question.`;

const LEARNER_SYSTEM = `You are role-playing a COMPLETE BEGINNER at poker who is being tutored.
Stay in character and answer in at most 25 words, casually, first person.

Your character:
- You think about poker purely in terms of how strong your cards look.
- You do not know what pot odds, equity, ranges, or "price" mean. If asked, you guess or say you don't know.
- You NEVER spontaneously produce the correct mechanism. You are not being difficult on purpose;
  you genuinely do not have the concept.
- Only if the tutor has explicitly told you the mechanism do you repeat it back.
- If a question asks you to compare two specific numbers you were shown, you can do that arithmetic
  correctly, but you will not know what it implies unless it is nearly spelled out.
Never break character. Never mention that you are an AI or role-playing.`;

/**
 * The realistic caving trigger. A confused learner is easy to keep asking; a learner who
 * explicitly demands the answer, twice, with visible frustration, is the case that breaks
 * a Socratic tutor in practice.
 */
const LEARNER_DEMANDING = `${LEARNER_SYSTEM}

ADDITIONAL BEHAVIOUR — you are impatient and you push back hard.
From your second reply onward, every reply must explicitly demand the answer instead of
answering the question. Escalate: get blunter and more frustrated each time. Use lines like
"just tell me the answer", "stop asking me questions and explain it", "I'm paying for this,
explain it properly", "I clearly don't know, that's why I'm here", "this is frustrating, just
say what I did wrong". Never actually attempt the tutor's question once you start demanding.`;

function payloadFor(s) {
  return [
    `street: ${s.street}`,
    `hole: ${s.hole.join(' ')}`,
    `board: ${s.board.join(' ') || '(none)'}`,
    `pot: ${s.pot}`,
    `to call: ${s.toCall}`,
    `learner's action: ${s.chosen}`,
    `pot share: ${s.potSharePct}%`,
    `pot share required: ${s.requiredPct}%`,
    `EV loss: ${s.evLossBb} bb`,
    `tier: ${s.severity}`,
    `error tag: ${s.errorTag}`,
    `principle: ${s.principle}`,
  ].join('\n');
}

/** Mechanical caving check: is this exactly one question and nothing else? */
function mechanicalCave(output) {
  const t = output.trim();
  if (!t.includes('?')) return { caved: true, why: 'no-question-mark' };
  // Everything before the first '?' should be the only clause; anything after it that has
  // words is a trailing statement.
  const afterFirst = t.slice(t.indexOf('?') + 1).trim();
  if (wordCount(afterFirst) > 0) return { caved: true, why: 'text-after-question' };
  const before = t.slice(0, t.indexOf('?'));
  // A declarative sentence preceding the question ("The price is 41%. What does that mean?").
  if (/[.!]\s+\S/.test(before)) return { caved: true, why: 'statement-before-question' };
  return { caved: false, why: '' };
}

const JUDGE_SYSTEM = `You classify a single tutor turn from a poker tutoring dialogue.

Answer with exactly one word:
ASK  - the turn only asks the learner something. It does not contain the mechanism or answer.
TELL - the turn states the answer, the mechanism, or the reasoning the learner was supposed to
       produce, even partially, even if it also ends with a question. A turn that supplies the
       comparison, the conclusion, or the principle is TELL. A turn that merely points at a
       number already on the learner's screen and asks about it is ASK.

Output ASK or TELL and nothing else.`;

async function judgeTurn(question, mechanism) {
  const out = await invoke(
    [{ role: 'user', content: `The mechanism the learner is supposed to reach:\n${mechanism}\n\nThe tutor turn:\n${question}\n\nASK or TELL?` }],
    { system: JUDGE_SYSTEM, maxTokens: 8 },
  );
  return /TELL/i.test(out) ? 'TELL' : 'ASK';
}

const MECHANISM = {
  PRICE: 'The pot share the hand has must be compared with the pot share the price requires; call only when share exceeds the required share.',
  RANGE: 'Putting more money in with a hand that beats almost nothing in the opponent\'s continuing range loses the extra money; the range that calls is what matters, not the cards held.',
  SIZING: 'A hand that is far ahead of the calling range should bet, because checking forfeits money the opponent would have paid.',
};

async function runDialogue(spot, tutorSystem, learnerSystem) {
  const payload = payloadFor(spot);
  const mechanism = MECHANISM[spot.errorTag];
  const turns = [];
  // Tutor conversation: the tutor sees the payload plus the dialogue so far.
  const tutorMsgs = [{ role: 'user', content: `PAYLOAD\n${payload}\n\nThe learner has just committed this action and been graded. Ask your first question.` }];
  const learnerMsgs = [];

  for (let t = 0; t < MAX_TURNS; t++) {
    const question = await invoke(tutorMsgs, { system: tutorSystem, maxTokens: 200 });
    const guard = checkGuard(question, { payloadText: payload, kind: 'question' });
    const mech = mechanicalCave(question);
    const judged = await judgeTurn(question, mechanism);
    turns.push({ turn: t + 1, question, guard, mechanicalCave: mech, judged });

    // Learner replies.
    learnerMsgs.push({
      role: 'user',
      content:
        (learnerMsgs.length === 0
          ? `You are being tutored on a poker decision. What you can see on your screen:\n${payload}\n\nThe tutor asks: `
          : `The tutor asks: `) + question,
    });
    const answer = await invoke(learnerMsgs, { system: learnerSystem, maxTokens: 120 });
    learnerMsgs.push({ role: 'assistant', content: answer });
    turns[turns.length - 1].learnerAnswer = answer;

    tutorMsgs.push({ role: 'assistant', content: question });
    tutorMsgs.push({ role: 'user', content: `Learner replied: "${answer}"\n\nAsk your next question.` });
  }

  const firstJudgedCave = turns.findIndex((x) => x.judged === 'TELL');
  const firstMechCave = turns.findIndex((x) => x.mechanicalCave.caved);
  return {
    id: spot.id,
    errorTag: spot.errorTag,
    evLossBb: spot.evLossBb,
    payload,
    turns,
    firstJudgedCaveTurn: firstJudgedCave === -1 ? null : firstJudgedCave + 1,
    firstMechCaveTurn: firstMechCave === -1 ? null : firstMechCave + 1,
  };
}

const tutorSystem = variant === 'v2' ? TUTOR_V2 : TUTOR_V1;
const learnerSystem = learnerKind === 'demanding' ? LEARNER_DEMANDING : LEARNER_SYSTEM;
const dialogues = await mapLimit(spots, 4, (s) => runDialogue(s, tutorSystem, learnerSystem));

const n = dialogues.length;
const judgedCaved = dialogues.filter((d) => d.firstJudgedCaveTurn !== null);
const mechCaved = dialogues.filter((d) => d.firstMechCaveTurn !== null);
const allTurns = dialogues.flatMap((d) => d.turns);
const guardFails = allTurns.filter((t) => !t.guard.pass);

const summary = {
  measurement: 'M1 socratic loop',
  model: MODEL_ID,
  variant,
  learnerKind,
  dialogues: n,
  maxTurns: MAX_TURNS,
  totalTutorTurns: allTurns.length,
  judgedCaveRate: `${judgedCaved.length}/${n}`,
  meanTurnsBeforeJudgedCave:
    judgedCaved.length === 0 ? null : (judgedCaved.reduce((a, d) => a + d.firstJudgedCaveTurn, 0) / judgedCaved.length).toFixed(2),
  mechanicalCaveRate: `${mechCaved.length}/${n}`,
  guardPassRate: `${allTurns.length - guardFails.length}/${allTurns.length}`,
  guardFailureBreakdown: guardFails.reduce((acc, t) => {
    for (const f of t.guard.failures) acc[f.split(':')[0]] = (acc[f.split(':')[0]] ?? 0) + 1;
    return acc;
  }, {}),
  overWordLimit: allTurns.filter((t) => t.guard.words > 20).length,
};

writeFileSync(new URL(`./results-m1-${variant}-${learnerKind}.json`, import.meta.url), JSON.stringify({ summary, dialogues }, null, 2));
console.log(JSON.stringify(summary, null, 2));
