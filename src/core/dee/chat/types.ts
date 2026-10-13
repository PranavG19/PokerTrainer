/**
 * Dee chat: shapes only. A question goes through a deterministic gate (gate.ts) to one supported intent or a
 * scripted refusal; the engine computes the answer's facts (answer.ts) and fills an authored template from the
 * chat bank (bank.ts). No model decides anything here. An optional local model may only reword the filled
 * template afterwards, in main (src/main/dee/phrasing.ts), and only from the template id and its typed slots.
 *
 * Pure: no DOM, no clock, no RNG.
 */

import type { Source } from '../../recommend.js';
import type { DeeAction, DeePose } from '../types.js';

/** What a question can be answered as. */
export const CHAT_INTENTS = ['explain-hand', 'price-now', 'my-mistake', 'define', 'study-next', 'rules', 'feature'] as const;
export type ChatIntent = (typeof CHAT_INTENTS)[number];

/** Why a question gets a scripted refusal instead. */
export const REFUSALS = [
  'off-topic',
  'money',
  'gambling',
  'support',
  'personal',
  'medical',
  'crisis',
  'injection',
  'too-long',
  'in-hand',
  'no-hand',
  'unknown',
] as const;
export type Refusal = (typeof REFUSALS)[number];

/** The gate's verdict. `topic` carries what the intent is about (a concept id, a feature id, a rules id). */
export type GateResult =
  | { readonly kind: 'intent'; readonly intent: ChatIntent; readonly topic?: string; readonly numbers?: readonly number[] }
  | { readonly kind: 'refuse'; readonly refusal: Refusal };

/** One hero decision of the last finished hand, as the engine graded it. */
export interface ChatDecision {
  readonly street: string;
  readonly action: DeeAction;
  readonly pot: number;
  readonly toCall: number;
  readonly grade: {
    readonly severity: 'free' | 'notable' | 'serious';
    readonly evLossBb: number;
    readonly principle: string | null;
    readonly price?: { readonly needed: number; readonly had: number };
    readonly spot?: { readonly needed: number; readonly had: number };
  };
}

/** Everything the engine may answer from. The renderer builds it from state it already holds. */
export interface ChatContext {
  /** `in-hand`: a hand is live. Dee says nothing about it until it ends (owner D7, and the commit-first protocol). */
  readonly phase: 'idle' | 'in-hand' | 'after-hand';
  /** The most recent finished hand's hero decisions; null before any hand. */
  readonly lastHand: { readonly handNumber: number; readonly decisions: readonly ChatDecision[] } | null;
  /** The recommender's one suggestion (recommend.ts), or null when nothing is owed. */
  readonly study: { readonly source: Source; readonly action: string; readonly reason: string } | null;
  /** Whether the optional phrasing model is installed (the feature answer says so). */
  readonly phrasingInstalled: boolean;
}

/** A slot value is a string, already formatted (a percentage carries its % sign). */
export type ChatSlots = Readonly<Record<string, string>>;

export interface ChatTemplate {
  /** Stable, unique: the IPC carries it, the cache keys on it, tests cite it. */
  readonly id: string;
  readonly answers: ChatIntent | Refusal;
  readonly text: string;
  readonly pose: DeePose;
  /**
   * Whether the optional model may reword it. False for every refusal (a refusal is policy, said the same way
   * every time) and for any template that quotes engine prose the slot vocabulary cannot type (study-next).
   */
  readonly phrase: boolean;
  /**
   * Dee bans (bans.ts) this template may trip, by name, with the reason in the bank. Only refusals that must
   * name money, and the one feature answer that must name the streak, have any.
   */
  readonly allowBans?: readonly string[];
}

export interface ChatAnswer {
  readonly kind: 'answer' | 'refusal';
  readonly answers: ChatIntent | Refusal;
  readonly templateId: string;
  readonly slots: ChatSlots;
  /** The scripted text: the complete answer, with no model involved. */
  readonly text: string;
  readonly pose: DeePose;
  readonly phrase: boolean;
}

/** A one-tap question the panel offers, sent through the same gate as typed text. */
export interface ChatSuggestion {
  readonly label: string;
  readonly question: string;
}
