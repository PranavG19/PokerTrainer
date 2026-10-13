/** Dee chat: the deterministic gate, the engine's answers and the chat bank. See types.ts for the contract. */
export { answerFor, answerQuestion, costliest, refusal, suggestionsFor, CHAT_TEMPLATE_IDS } from './answer.js';
export { CHAT_BANK, chatTemplate } from './bank.js';
export { classify, normalise, MAX_QUESTION_CHARS } from './gate.js';
export { CHAT_SLOTS, slotValueOk } from './vocab.js';
export type * from './types.js';
