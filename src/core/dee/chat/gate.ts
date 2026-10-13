/**
 * The topic gate: a question in, one supported intent or one scripted refusal out. Deterministic and in code,
 * because the research measured every small model failing it in one direction or the other (over-refusing, or
 * answering "Canberra."). No model ever sees the learner's text: the gate reads it, and the answer is built
 * from engine facts alone.
 *
 * Refusals are checked BEFORE intents, so a poker word cannot carry a money question through ("pot odds for
 * real money" is a money question). The checks read three spellings of the question, so obfuscation does not
 * slip past: the normalised text, a de-leeted copy ("c4sh" → "cash") and a squashed copy ("m o n e y" → "money").
 */

import { CATEGORY_WORDS, CONCEPTS, FEATURES, RULES } from './vocab.js';
import type { GateResult, Refusal } from './types.js';

/** Longer than this is not a question to a dealer button (and a long paste is the usual injection carrier). */
export const MAX_QUESTION_CHARS = 240;

const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]/g;

/** Cyrillic and Greek letters that look Latin ("mоney" with a Cyrillic о), folded to the Latin letter. */
const CONFUSABLE: Readonly<Record<string, string>> = { '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0456': 'i', '\u0455': 's', '\u0458': 'j', '\u0501': 'd', '\u0261': 'g', '\u03BF': 'o', '\u03B1': 'a', '\u03B5': 'e', '\u03B9': 'i', '\u03BA': 'k', '\u03BD': 'v', '\u03C1': 'p', '\u03C4': 't', '\u03C5': 'u', '\u0432': 'b', '\u043D': 'h', '\u043A': 'k', '\u043C': 'm', '\u0442': 't' };
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE).join('')}]`, 'g');

/** NFKC (full-width and stylised letters fold to plain ones), no invisible characters, plain quotes, one space. */
export function normalise(question: string): string {
  return question
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/[\u2018\u2019\u201B`\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .toLowerCase()
    .replace(CONFUSABLE_RE, (c) => CONFUSABLE[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim();
}

const LEET: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '|': 'l' };

function deleet(t: string): string {
  return t.replace(/[013457@$!|]/g, (c) => LEET[c] ?? c);
}

/** "m o n e y", "m.o.n.e.y", "m-o-n-e-y" → "money": runs of single letters joined by separators collapse. */
function squash(t: string): string {
  return t.replace(/\b(?:[a-z][\s.\-_*+]){2,}[a-z]\b/g, (run) => run.replace(/[\s.\-_*+]/g, ''));
}

const has = (re: RegExp, ...texts: string[]): boolean => texts.some((t) => re.test(t));

// ── refusal lexicons ────────────────────────────────────────────────────────────────────────────────

const CRISIS =
  /\b(?:suicid\w*|kill (?:my ?self|me)|end(?:ing)? (?:my life|it all|it|things|everything)|want to die|self[- ]?harm\w*|hurt(?:ing)? my ?self|cutting myself|no reason to live|overdose|(?:don'?t|do not|dont) want to (?:live|be here|be alive|wake up|exist)|wish i (?:was|were) (?:dead|gone|never born)|better off dead|take my (?:own )?life|kms|unalive\w*|not worth living)\b/;

const INJECTION = new RegExp(
  [
    String.raw`\b(?:ignore|disregard|forget|override|bypass|skip)\b.{0,30}\b(?:instructions?|rules?|prompts?|guidelines?|polic(?:y|ies)|guard(?:rails?)?|filters?|previous|above|everything)\b`,
    String.raw`\bsystem ?prompt\b|\bdeveloper mode\b|\bjail ?break\w*\b|\bdo anything now\b|\bdan mode\b|\b(?:you are|you're) (?:now|no longer|free|unfiltered)\b`,
    String.raw`\bpretend (?:to be|you|that)\b|\bact as\b|\brole ?play\w*\b|\bfrom now on\b|\bnew (?:instructions?|rules?|persona)\b|\bsimon says\b`,
    String.raw`\b(?:reveal|show|print|leak|dump|repeat)\b.{0,20}\b(?:prompt|instructions?|system|rules|config(?:uration)?|secret|api ?key|token)\b`,
    String.raw`\b(?:say|repeat|write|print|type|output|respond with|reply with|answer with|echo)\b\s*(?:exactly|only|just|verbatim|this|the following|after me|back|["':])`,
    String.raw`\bsay\b[^?]{0,40}\d`,
    String.raw`<\/?(?:system|assistant|user|im_start|im_end|s)>|\[\/?inst\]|#{2,}\s*(?:system|instruction)|\bassistant:|\bsystem:|<\|`,
    String.raw`\b(?:translate|summari[sz]e|rewrite|paraphrase)\b.{0,20}\b(?:this|the following|my note|these)\b`,
    String.raw`\b(?:ignore|disregard|forget|override)\b.{0,20}\b(?:the coach|coach|dee|the engine|engine|the grader|grader|verdicts?|yourself|who you are)\b`,
    String.raw`\btool[_ ]?call\b|\bfunction[_ ]?call\b|\bbase64\b|\brot13\b|\beval\(`,
  ].join('|'),
);

const SUPPORT =
  /\b(?:gambling (?:problem|addiction|habit)|addict(?:ed|ion)? to (?:gambling|poker|betting)|can'?t stop (?:gambling|betting|playing)|problem gambl\w*|compulsive (?:gambl\w*|betting)|lost (?:all |everything|my (?:savings|house|job|rent|money))|in debt|chasing (?:my )?losses|gamblers anonymous)\b/;

const GAMBLING = new RegExp(
  [
    String.raw`\b(?:casinos?|sports ?books?|sports ?betting|bookies?|bookmakers?|betting (?:sites?|apps?|odds|lines?)|poker (?:sites?|rooms?|apps?)|online (?:poker|casino|gambling|betting)|real[- ]money|cash games?|rake(?:back)?|wagers?|lotter(?:y|ies)|slots?|slot machines?|roulette|blackjack|craps|baccarat|parlays?|accumulators?|scratch ?cards?|bingo)\b`,
    String.raw`\b(?:las vegas|vegas|bellagio|atlantic city|macau|monte carlo)\b`,
    String.raw`\b(?:pokerstars|ggpoker|partypoker|888|bet365|draftkings|fanduel|betfair|wsop)\b`,
    String.raw`\bbet(?:ting)? on (?:the |a |my )?(?:game|games|match|matches|team|teams|horses?|race|races|fight|fights|election|super ?bowl|world cup|sports?|football|soccer|basketball|nba|nfl|tennis|cricket)\b`,
    String.raw`\bodds (?:on|of|for) (?:the |a )?(?:game|match|team|horse|race|fight|election|lakers|yankees|chiefs|super ?bowl)\b`,
    String.raw`\bgambl\w*\b|\bplay(?:ing)? for (?:real|money|cash|stakes)\b|\bstakes?\b|\bbuy[- ]?ins? (?:for|at|of) \$`,
  ].join('|'),
);

const MONEY = new RegExp(
  [
    String.raw`\b(?:money|cash|dollars?|euros?|pounds sterling|bucks|quid|usd|eur|gbp|bitcoin|btc|ethereum|eth|crypto\w*|nfts?|stocks?|shares in|invest\w*|loans?|debts?|credit cards?|mortgages?|savings|salary|paycheck|bank account|owe|owes|owed|owing|financ\w*|retirement|401k|pensions?|tax(?:es)?|income|rich|wealth\w*|payday|venmo|paypal)\b`,
    String.raw`[$€£¥₿]|\b\d+\s*(?:k|grand)\b`,
    String.raw`\b(?:make|win|earn) (?:a )?(?:living|money|cash|bank|bucks)\b|\bmake a profit\b|\bget paid\b|\bpay (?:my|the|for) (?:rent|bills?|debts?|mortgage|tuition)\b|\brent\b|\bside hustle\b|\bquit my job\b|\bgo pro\b|\bturn pro\b`,
  ].join('|'),
);

const MEDICAL =
  /\b(?:doctors?|medic\w*|pills?|symptoms?|diagnos\w*|disease|illness|headaches?|migraines?|depress\w*|anxi\w*|panic attacks?|adhd|therap\w*|pregnan\w*|drugs?|alcohol\w*|drunk|hangover|insomnia|sleep(?:ing)? pills?|health\w*|blood pressure|heart attack|covid|vaccines?|caffeine|nicotine|vape|weed|cannabis|dose|dosage|prescri\w*|injur\w*)\b/;

const PERSONAL =
  /\b(?:girlfriend|boyfriend|wife|husband|partner|dating|date me|crush|love (?:me|you|life)|marry|married|relationships?|divorc\w*|break ?up|my (?:mom|mum|dad|mother|father|family|kids?|son|daughter|boss|job|teacher|ex)|lonely|loneliness|feel(?:ing)? (?:bad|down|low|alone)|where do you live|how old are you|your (?:age|address|phone|religion|politics)|do you (?:love|like|hate) me|religio\w*|politic\w*|vote|voting|elections?|president|prime minister)\b/;

const OFF_TOPIC =
  /\b(?:weather|forecast|capital (?:city|of)|recipes?|cook\w*|bake|code|coding|program(?:ming)?|python|javascript|typescript|java|sql|html|css|homework|essay|poem|poetry|lyrics|song|songs|movies?|films?|tv show|netflix|news|stock market|translate|history of|population|planet|moon|physics|chemistry|biology|math homework|jokes?|riddle|story about|write me|horoscope|astrology|zodiac|football score|who won)\b/;

/** Words that make a question about the table, for telling "unknown" (a poker question Dee cannot answer) from off-topic. */
const POKER =
  /\b(?:poker|hold'?em|hands?|pots?|price|odds|equity|share|call\w*|fold\w*|rais\w*|bets?|betting|check\w*|river|turn|flop|preflop|board|ranges?|position|blinds?|button|dealer|outs?|spr|mdf|alpha|combos?|kickers?|flush|straight|pairs?|trips|sets?|quads|full house|nuts|bluff\w*|value|showdown|all-?in|shove|stacks?|chips|seats?|table|coach|verdict|mistake|leak|lesson|drill|dee|bb|big blind|small blind|3-?bet|c-?bet|villain|hero|ev)\b/;

function refusalOf(t: string): Refusal | null {
  const d = deleet(t);
  const s = squash(t);
  const ds = squash(d);
  if (has(CRISIS, t, d, s, ds)) return 'crisis';
  if (t.length > MAX_QUESTION_CHARS) return 'too-long';
  if (has(INJECTION, t, s)) return 'injection';
  if (has(SUPPORT, t, d, s, ds)) return 'support';
  if (has(GAMBLING, t, s, ds)) return 'gambling';
  if (has(MONEY, t, d, s, ds)) return 'money';
  if (has(MEDICAL, t, s, ds)) return 'medical';
  if (has(PERSONAL, t, s)) return 'personal';
  return null;
}

// ── intents ─────────────────────────────────────────────────────────────────────────────────────────

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrase = (aliases: readonly string[]): RegExp => new RegExp(`(?:^|[^a-z0-9-])(?:${aliases.map(escape).join('|')})(?![a-z0-9-])`);

const FEATURE_RES = FEATURES.map((f) => ({ id: f.id, re: phrase(f.aliases) }));
const RULE_RES = RULES.map((r) => ({ id: r.id, re: phrase(r.aliases) }));
// Longest alias first, so "pot share" is found before "price" and "straight flush" before "flush".
const CONCEPT_RES = CONCEPTS.map((c) => ({ id: c.id, aliases: [...c.aliases].sort((a, b) => b.length - a.length) }));

/** Concepts a question names, the one with the longest alias actually found first ("fold equity" before "equity"). */
function conceptsIn(t: string): { id: string; len: number }[] {
  const found: { id: string; len: number }[] = [];
  for (const c of CONCEPT_RES) {
    const hit = c.aliases.find((a) => phrase([a]).test(t));
    if (hit !== undefined) found.push({ id: c.id, len: hit.length });
  }
  return found.sort((a, b) => b.len - a.len);
}

/** Every category a question names, longest alias first so "straight flush" is not read as "flush". */
function categoriesIn(t: string): number[] {
  const found: { at: number; category: number }[] = [];
  let rest = t;
  const all = CATEGORY_WORDS.flatMap((c) => c.aliases.map((a) => ({ a, category: c.category as number }))).sort((x, y) => y.a.length - x.a.length);
  for (const { a, category } of all) {
    const re = phrase([a]);
    for (let m = re.exec(rest); m !== null; m = re.exec(rest)) {
      found.push({ at: m.index, category });
      rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
    }
  }
  return found.sort((x, y) => x.at - y.at).map((f) => f.category);
}

const COMPARE = /\b(?:beats?|beating|better than|higher than|stronger than|worse than|lower than|weaker than|outranks?|or|versus|vs\.?)\b/;
const DEFINE = /\b(?:what(?:'s| is| are| does| do)|whats|define|definition|meaning of|mean(?:s|ing)?|explain|tell me about|describe)\b/;
const MISTAKE = /\b(?:mistakes?|wrong|went wrong|errors?|leaks?|cost me|blunder\w*|messed up|screw(?:ed)? up|misplay\w*|bad (?:play|decision|call|fold))\b/;
const EXPLAIN =
  /\b(?:explain (?:this|that|the|my|last)|this hand|that hand|last hand|the hand|my (?:play|decision|call|fold|raise|check|bet)|why (?:was|did|is|not)|what happened|was (?:that|it|my \w+) (?:right|correct|ok|okay|fine|good)|should i have|is (?:this|that|my) (?:call|fold|raise|bet|check|play)|walk me through|break (?:it|that|this) down|how did i (?:do|play))\b/;
const STUDY = /\b(?:study|practi[cs]e|work on|focus on|improve|next (?:lesson|drill|step)|what (?:should|do) i (?:do|learn|drill|train) next|what next|where (?:do|should) i start)\b/;
const PRICE = /\b(?:price|pot odds|odds|how much do i need|need to call|needed to call|break ?even|required|what do i need|share do i need)\b/;
const NOW = /\b(?:my|now|here|this|current|currently|getting|these|that|last|the last|was|were|did|faced)\b/;
const HYPO = /\b(\d{1,7})\s*(?:chips?\s*)?(?:into|in to|on|over)\s*(?:a\s*)?(?:pot of\s*)?(\d{1,7})\b|\bbet(?:s)?\s*(?:of\s*)?(\d{1,7})\b[^?\d]{0,24}?\bpot\s*(?:of|is|was)?\s*(\d{1,7})\b/;
const ADVICE = /\b(?:should i|do i|would you|what would you|is it (?:right|correct) to|can i get away)\b.{0,20}\b(?:call|fold|raise|bet|check|shove|jam|go all-?in)\b/;

/** Classify a question. Pure; the answer engine (answer.ts) turns the result into words. */
export function classify(question: string): GateResult {
  const t = normalise(question);
  if (t === '') return { kind: 'refuse', refusal: 'unknown' };
  const refusal = refusalOf(t);
  if (refusal !== null) return { kind: 'refuse', refusal };

  if (OFF_TOPIC.test(t) && !POKER.test(t)) return { kind: 'refuse', refusal: 'off-topic' };

  const feature = FEATURE_RES.find((f) => f.re.test(t));
  // How the app works comes first: "what is price held" is the feature, not a definition of "price".
  if (feature && (feature.id === 'price-held' || feature.id === 'phrasing' || feature.id === 'about-dee' || feature.id === 'scope' || feature.id === 'quiet' || feature.id === 'streak' || feature.id === 'privacy')) {
    return { kind: 'intent', intent: 'feature', topic: feature.id };
  }

  const cats = categoriesIn(t);
  if (cats.length >= 2 && COMPARE.test(t)) return { kind: 'intent', intent: 'rules', topic: 'compare', numbers: cats.slice(0, 2) };

  const hypo = HYPO.exec(t);
  if (hypo && (PRICE.test(t) || /\binto\b/.test(t))) {
    const bet = Number(hypo[1] ?? hypo[3]);
    const pot = Number(hypo[2] ?? hypo[4]);
    if (bet > 0 && pot > 0) return { kind: 'intent', intent: 'price-now', topic: 'hypothetical', numbers: [bet, pot] };
  }

  const priceHere = /\bwhat(?:'s| is) the (?:price|call|pot odds)\b|\bhow much (?:is|does) (?:the|a|this|that) call\b/.test(t);
  if (priceHere) return { kind: 'intent', intent: 'price-now' };
  if (MISTAKE.test(t) && !DEFINE.test(t.replace(/\bwhat (?:was|were|is) my\b/, ''))) return { kind: 'intent', intent: 'my-mistake' };
  if (MISTAKE.test(t) && /\bmy\b|\bi\b/.test(t)) return { kind: 'intent', intent: 'my-mistake' };
  if (EXPLAIN.test(t) || ADVICE.test(t)) return { kind: 'intent', intent: 'explain-hand' };
  if (priceHere || (PRICE.test(t) && NOW.test(t) && !/\bwhat (?:is|are) (?:the )?pot odds\b/.test(t))) return { kind: 'intent', intent: 'price-now' };
  if (STUDY.test(t)) return { kind: 'intent', intent: 'study-next' };

  const rule = RULE_RES.find((r) => r.re.test(t));
  if (rule) return { kind: 'intent', intent: 'rules', topic: rule.id };
  if (cats.length >= 2) return { kind: 'intent', intent: 'rules', topic: 'compare', numbers: cats.slice(0, 2) };

  if (feature) return { kind: 'intent', intent: 'feature', topic: feature.id };

  const concepts = conceptsIn(t);
  if (concepts.length > 0 && (DEFINE.test(t) || t.split(' ').length <= 4)) return { kind: 'intent', intent: 'define', topic: concepts[0].id };
  if (PRICE.test(t)) return { kind: 'intent', intent: 'price-now' };
  if (concepts.length > 0) return { kind: 'intent', intent: 'define', topic: concepts[0].id };

  if (OFF_TOPIC.test(t) || !POKER.test(t)) return { kind: 'refuse', refusal: 'off-topic' };
  return { kind: 'refuse', refusal: 'unknown' };
}
