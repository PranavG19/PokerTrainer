import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';

/**
 * Optional spoken narration of coach verdicts through macOS's built-in /usr/bin/say.
 *
 * Two rules shape this file, and both are load-bearing:
 *
 *  - The verdict is an ARGUMENT, never part of a command line. spawn() with an argv array and
 *    `shell: false` means no shell ever parses it, so `; rm -rf ~` is a phrase to read out, not a
 *    command. The `--` separator is the other half of that: without it a verdict that happened to
 *    start with '-' would be read by `say` as one of its own flags rather than as speech.
 *
 *  - Speech is strictly additive. Every failure path RESOLVES with a reason instead of throwing: a
 *    missing binary, a spawn error, a non-zero exit and a cancelled utterance all settle normally,
 *    so a broken speaker can never interrupt a hand. The verdict text is already on screen.
 */

/**
 * Read per call, not captured at import: the tests point this at a recorder to assert on the real
 * argv the app builds. Still an executable path handed to spawn(), never a shell string, so an
 * override cannot introduce interpretation either.
 */
function sayBinary(): string {
  return process.env.OFFSUIT_SAY_BINARY ?? '/usr/bin/say';
}

/**
 * A coach verdict is one sentence (~100 chars). The cap is not a formatting preference: `say` holds
 * its process open for roughly a second per five words, so an unbounded string would leave one hand
 * narrating over the next three.
 */
export const SPEECH_MAX_CHARS = 240;

export interface SpeakResult {
  spoken: boolean;
  /** null exactly when spoken. Otherwise why not, so Settings can say so in words. */
  reason: string | null;
}

/** Control characters carry nothing a voice can read and would otherwise land raw in an argv. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * The pure half: whitespace-flattened and capped, or null when there is nothing worth saying.
 *
 * Shell metacharacters are deliberately NOT stripped. Stripping them would be defence in the wrong
 * place — it would imply the text reaches a shell, and it would silently mangle a verdict that
 * legitimately contains a `$` or a `&`. Safety comes from the argv boundary in speak(); this
 * function only decides what is worth reading aloud.
 */
export function speakableText(raw: string): string | null {
  const flat = raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  if (flat.length <= SPEECH_MAX_CHARS) return flat;

  // Cut on a word boundary when there is one, so the voice does not stop mid-syllable.
  const cut = flat.slice(0, SPEECH_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

/** The utterance in flight, or null. At most one, ever. */
let current: ChildProcess | null = null;

/**
 * Stop whatever is being said. Clearing the slot BEFORE the kill is what lets the exit handler tell
 * a cancellation from a crash: the child that finds itself no longer `current` was replaced.
 */
export function cancelSpeech(): void {
  if (current === null) return;
  const child = current;
  current = null;
  child.kill('SIGTERM');
}

function executable(binary: string): boolean {
  try {
    fs.accessSync(binary, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Speak one verdict, cancelling any previous one.
 *
 * `raw` is typed unknown because it arrives over IPC: the renderer is trusted here, but an IPC
 * handler that assumes its argument's type is one malformed message away from taking the app down.
 *
 * Resolves when the utterance ends, so the caller can report the real outcome. Callers must NOT
 * await it inside a hand's control flow — a verdict takes seconds to read.
 */
export function speak(raw: unknown): Promise<SpeakResult> {
  if (typeof raw !== 'string') return Promise.resolve({ spoken: false, reason: 'not-text' });

  const text = speakableText(raw);
  if (text === null) return Promise.resolve({ spoken: false, reason: 'empty' });

  // A new verdict replaces the old one on screen; it replaces it in the speaker too. Two voices
  // reading two contradictory verdicts over each other is worse than silence.
  cancelSpeech();

  const binary = sayBinary();
  if (!executable(binary)) return Promise.resolve({ spoken: false, reason: 'unavailable' });

  let child: ChildProcess;
  try {
    child = spawn(binary, ['--', text], { stdio: 'ignore', shell: false });
  } catch {
    return Promise.resolve({ spoken: false, reason: 'spawn-failed' });
  }
  current = child;

  return new Promise<SpeakResult>((resolve) => {
    child.once('error', () => {
      if (current === child) current = null;
      resolve({ spoken: false, reason: 'spawn-failed' });
    });
    child.once('exit', (code, signal) => {
      const cancelled = current !== child;
      if (!cancelled) current = null;
      if (cancelled) resolve({ spoken: false, reason: 'cancelled' });
      else if (signal !== null) resolve({ spoken: false, reason: `signal-${signal}` });
      else if (code === 0) resolve({ spoken: true, reason: null });
      else resolve({ spoken: false, reason: `exit-${String(code)}` });
    });
  });
}
