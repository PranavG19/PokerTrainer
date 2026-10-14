/**
 * DISPLAY NAMES — the one piece of player-written text an online table shows (research §3.4). Names are
 * still user content, so they are short, from a plain character set, and checked against a small
 * denylist and the names that would impersonate the service. Applied by the server, which is the gate;
 * the app runs the same check first only to say what is wrong before asking.
 */

export const NAME_MIN = 2;
export const NAME_MAX = 16;

/** Names that would read as the service or its staff. */
const RESERVED = ['offsuit', 'admin', 'moderator', 'mod', 'dealer', 'server', 'system', 'support', 'staff', 'dee'];

/**
 * Substrings refused anywhere in a name, after folding case, accents, digits-as-letters and separators.
 * Deliberately short: it catches the obvious, and invite-only tables keep the rest among people who chose
 * each other. Stored folded so the list itself reads as little as possible.
 */
const DENIED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'whore', 'slut', 'retard', 'kike', 'spic', 'chink', 'twat', 'wank', 'dick', 'cock', 'pussy', 'bitch'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's' };

/** Lowercase, strip accents, map look-alike digits to letters and drop everything that is not a letter. */
function fold(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0-9@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, '');
}

export function normaliseName(raw: unknown): { readonly name: string } | { readonly error: string } {
  if (typeof raw !== 'string') return { error: 'Choose a name.' };
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { error: `Use ${NAME_MIN} to ${NAME_MAX} characters.` };
  }
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) {
    return { error: 'Use letters, numbers, spaces, dots, dashes or underscores.' };
  }
  const folded = fold(name);
  if (RESERVED.includes(folded)) return { error: 'That name is reserved.' };
  if (DENIED.some((word) => folded.includes(word))) return { error: 'Choose a different name.' };
  return { name };
}
