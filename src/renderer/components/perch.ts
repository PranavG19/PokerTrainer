import type { DeePose } from '../../core/dee/types.js';
import { blinkDee, prefersReducedMotion, renderDee, setDeePose } from './dee.js';

/**
 * Dee's perch: Dee at 20px plus the daily streak, at the right of the title bar, with no glass of its own
 * (VISION §5). It is a button: it opens Dee's settings.
 *
 * In-hand Dee says nothing (owner D7); the perch only changes pose. The table reports what is happening
 * (`setPose(source, pose)`), and the perch shows the highest-priority pose any source holds: a serious verdict
 * outranks the gate, which outranks a glance at the reason being typed. With nothing held it rests, blinks every
 * 4–9 s (never while the hero is to act) and lies flat after two quiet minutes. Reduced motion: no blink, and a
 * pose swaps instantly.
 */

const PRIORITY: Record<DeePose, number> = {
  serious: 7,
  'price-held': 6,
  gate: 5,
  listening: 4,
  thinking: 3,
  glance: 2,
  rest: 1,
  asleep: 0,
};

const IDLE_MS = 120_000;

export interface PerchHandle {
  readonly root: HTMLButtonElement;
  /** Hold a pose for `source`, or release it with null. */
  setPose(source: string, pose: DeePose | null): void;
  /** The hero is to act: no blinking (a blink would draw the eye from the decision). */
  setActing(on: boolean): void;
  setStreak(days: number): void;
  destroy(): void;
}

export function renderPerch(onOpen: () => void): PerchHandle {
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'perch';
  root.dataset.testid = 'dee-perch';
  root.addEventListener('click', onOpen);

  const mark = renderDee('rest', 20);
  const streak = document.createElement('span');
  streak.className = 'perch-streak g-num';
  streak.dataset.testid = 'perch-streak';
  streak.setAttribute('aria-hidden', 'true');
  root.append(mark, streak);

  const held = new Map<string, DeePose>();
  let acting = false;
  let asleep = false;
  let days = 0;
  let blinkTimer: number | null = null;
  let idleTimer: number | null = null;

  function current(): DeePose {
    let best: DeePose = asleep ? 'asleep' : 'rest';
    for (const pose of held.values()) if (PRIORITY[pose] > PRIORITY[best]) best = pose;
    return best;
  }

  function label(): void {
    const parts = ['Dee', 'open Dee’s settings'];
    if (days > 0) parts.push(`${days}-day streak`);
    root.setAttribute('aria-label', parts.join(', '));
    root.dataset.pose = current();
  }

  function apply(): void {
    setDeePose(mark, current());
    label();
  }

  function scheduleBlink(): void {
    if (blinkTimer !== null) window.clearTimeout(blinkTimer);
    blinkTimer = null;
    if (prefersReducedMotion()) return;
    // 4–9 s, varied without a random source: the interval walks a fixed cycle.
    const cycle = [5200, 7400, 4300, 8600, 6100];
    const delay = cycle[Math.floor(Date.now() / 1024) % cycle.length];
    blinkTimer = window.setTimeout(() => {
      if (!acting && held.size === 0 && !asleep && root.isConnected) blinkDee(mark);
      scheduleBlink();
    }, delay);
  }

  function wake(): void {
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      asleep = true;
      apply();
    }, IDLE_MS);
    if (asleep) {
      asleep = false;
      apply();
    }
  }

  const activity = (): void => wake();
  window.addEventListener('pointerdown', activity, true);
  window.addEventListener('keydown', activity, true);
  wake();
  scheduleBlink();
  label();

  return {
    root,
    setPose(source, pose) {
      if (pose === null) held.delete(source);
      else held.set(source, pose);
      apply();
    },
    setActing(on) {
      acting = on;
    },
    setStreak(n) {
      days = Math.max(0, Math.floor(n));
      streak.textContent = days > 0 ? String(days) : '';
      streak.hidden = days === 0;
      label();
    },
    destroy() {
      if (blinkTimer !== null) window.clearTimeout(blinkTimer);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      window.removeEventListener('pointerdown', activity, true);
      window.removeEventListener('keydown', activity, true);
    },
  };
}
