# Adding one lesson

You are adding **one** lesson. Two files change and nothing else:

1. **new** `src/core/lessons/content/<lesson-id>.ts`
2. **edit** `src/core/lessons/index.ts` — two lines

Do not touch `types.ts`, `validate.ts`, `AUTHORING.md`, `tests/unit/lessons.test.ts`, or any other
lesson's content file. Do not add an npm dependency. Read
`src/core/lessons/content/pot-odds-as-a-price.ts` first: it is the reference, and copying its
shape is faster than reading this document twice.

## The content file

File name is the lesson id, kebab-case, `.ts`. Export **one** `const` named in camelCase, typed
`Lesson`, and nothing else. No functions, no DOM, no imports beyond the type:

```ts
import type { Lesson } from '../types.js';

export const yourLessonId: Lesson = {
  id: 'your-lesson-id',      // must equal the file name
  phase: 2,                  // 0 Rules | 1 Eyes | 2 Arithmetic | 3 Principles
  title: 'Short noun phrase',
  mechanism: 'One sentence naming the mechanism, not a conclusion.',
  prerequisites: [],         // ADVISORY ONLY — see N1 below
  examples: [ /* 2 or 3 */ ],
  acceptanceKeywords: ['...'],
};
```

`Card` is a two-char string (`'As'`, `'Th'`) — ranks `23456789TJQKA`, suits `shdc`. Import paths
end in `.js`; that is the compiled specifier and TypeScript requires it here.

## Registering it in index.ts

Exactly two edits to `src/core/lessons/index.ts`, nothing else in that file:

```ts
import { yourLessonId } from './content/your-lesson-id.js';   // add beside the other imports
```

```ts
export const LESSONS: readonly Lesson[] = [potOddsAsAPrice, yourLessonId];   // append
```

Append; do not reorder the array. Order is authoring order, and no code may read it as a
curriculum queue.

## What the validator rejects

`npx vitest run tests/unit/lessons.test.ts` walks every registered lesson through
`validate.ts`. A green run is the definition of done. It fails on:

| code | cause |
|---|---|
| `duplicate-lesson-id` | two registered lessons share an `id` |
| `duplicate-example-id` | two examples in one lesson share an `id` |
| `unknown-prerequisite` | a prerequisite names no registered lesson |
| `prerequisite-cycle` / `self-prerequisite` | the prerequisite graph loops |
| `unbuildable-example` | the position cannot be dealt or played — see below |
| `prose-too-long` | title >10, mechanism >30, prompt >25, reasoning >60 words |
| `prose-shape` | reasoning is not 3 sentences; prompt does not end in `?`; prose opens on "you"; id not kebab-case |
| `banned-phrase` | a construction from the list below |
| `empty-lesson` | no examples, or no `acceptanceKeywords` |

### `unbuildable-example` — the check that matters

Every example is dealt from a real 52-card deck and seated on the real betting engine
(`src/core/table.ts`), which then has to agree hero can make the move the example describes. To
satisfy it:

- `hole` is exactly 2 cards; every card in `hole` + `board` is distinct and legal.
- `board.length` matches `street`: `preflop` 0, `flop` 3, `turn` 4, `river` 5. `showdown` is
  never valid — it offers no decision.
- `villainStacks.length` is 1 to 3 (the table seats 4). Seats not listed folded earlier; their
  chips are already inside `pot`.
- `bb` is a positive **even** number of chips (the engine posts `bb / 2` as the small blind).
- `pot > 0`, `toCall >= 0`, `toCall <= pot`. `pot` **includes** the bet hero faces; `toCall` is
  the chips hero adds on top. A 70 bet into 110 means `pot: 180, toCall: 70`.
- `toCall: 0` is fine — the engine offers `check` and the example still builds.
- `heroStack` and every villain stack are non-negative. `heroStack <= toCall` builds as an all-in.

If it fails, the error names the reason (`card dealt twice: Ah`, `toCall 500 exceeds pot 200`,
`engine offers [fold, check] but the example needs call`). Fix the numbers; do not touch the
validator.

## Prose rules — breaking these makes the content harmful

**G6 — `reasoning` is exactly three sentences, ≤60 words, task-as-subject, ending in a next
action.** The subject is the hand, the bet, the price, the board — never the learner. The third
sentence is an instruction the learner can carry to the next hand ("Count the river card only,
not both streets.").

**G5 / story 12 — `prompt` asks a question and never hints at the answer.** The learner names the
spot and commits before `reasoning` is visible. A prompt containing the action ("Should this call,
given the price is 1 in 5?") deletes the skill the lesson exists to build. Ends in `?`.

**G7 — never a trait claim.** No "you're too loose", no "your tendency", no archetype label
applied to the learner. Errors aggregate by tag, never by trait.

**No praise, no streaks, no XP, no ranks, no percentiles, no per-hand fold reveals.** "Nice
call", "three in a row", "90th percentile", "would have flopped a straight" all fail the lint.
Silence is not praise (G3) and a counterfactual from n = 1 teaches a false rule (G10).

**N1 — nothing is ever locked.** `prerequisites` is advice a recommender may order by. No code
gates, greys out, or refuses entry on it, and prose must not imply a lesson is unavailable.

**Arithmetic in natural frequencies.** Phase 2 prose says "about 2 times in 7", not "29%". A
remembered percentage transfers to nothing; a frequency is re-derivable from two numbers on
screen.

**V2 — no colour instructions in content.** Mint `#3DDC97` is reserved; severity is type weight
and position. Content is inert data and never names a colour.

## `mechanism` and `acceptanceKeywords`

`mechanism` is the target the learner's own sentence is compared against (L1), so it states a
mechanism: *domination risk, equity realisation, range asymmetry, a price*. `acceptanceKeywords`
are the phrases L2's fallback check accepts from that sentence — mechanism framings only. Never a
cached cell like `"K7s is a CO open"`, which names a conclusion instead of the reason.

## Examples: 2 or 3, one variable apart

Write two or three examples that differ in **exactly one** variable, so the learner can find the
boundary themselves (story 19). The reference lesson walks bet size across three sizings and holds
everything else steady.

## Before you report done

```
npm run typecheck
npx vitest run tests/unit/lessons.test.ts
```

Both must exit 0. Report both exit codes and the pass count. Never weaken, skip, or delete a test
to get there.
