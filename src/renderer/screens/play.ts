import type { SessionPlan } from '../../core/sessionPlan.js';
import type { SessionState } from '../../core/session.js';
import { renderSessionPlanner } from './sessionPlan.js';
import { launchRow, renderNewSessionCard, renderPlayWithFriendsCard } from './home.js';
import { codeIcon, spadeIcon } from '../components/glyphs.js';

/**
 * PLAY (1.14): where a sitting starts when no table is up. The launch rows (a free table, friends on the local
 * network, the weekly assessment block) and the session planner, which moved here from Home. A live table, the
 * multiplayer and online panels, the assessment and the variance explainer all render in this section instead.
 */
export function renderPlay(opts: {
  session: SessionState;
  onNewSession: () => void;
  /** A 6-max table (BUILD-PLAN 2.12): five opponents, the same free table otherwise. */
  onNewSixMax: () => void;
  onStartPlanned: (plan: SessionPlan) => void;
  onPlayWithFriends: () => void;
  onStartAssessment: () => void;
  /** Play → Challenge a friend (screens/challenge.ts). Absent: no row. */
  onChallenge?: () => void;
}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'home-screen play-screen';
  root.dataset.testid = 'play-screen';

  const col = document.createElement('div');
  col.className = 'home-col';
  const h = document.createElement('h1');
  h.className = 't-t2 habit-flush';
  h.textContent = 'Play';
  const sub = document.createElement('p');
  sub.className = 'g-sub habit-flush';
  sub.textContent = 'Every table is graded on the decisions, never the chips. Nothing here is locked.';
  const launch = document.createElement('div');
  launch.className = 'g-group home-launch';
  launch.append(
    renderNewSessionCard(opts.onNewSession),
    launchRow('play-six-max', spadeIcon(), '6-max table', 'Five opponents, UTG round to the big blind', opts.onNewSixMax),
    renderPlayWithFriendsCard(opts.onPlayWithFriends),
    launchRow('play-assessment', spadeIcon(), 'Assessment block', 'Thirty spots with the feedback held to the end', opts.onStartAssessment),
  );
  if (opts.onChallenge) {
    launch.appendChild(launchRow('play-challenge', codeIcon(), 'Challenge a friend', 'Play a code, or make one: the same spot for both of you', opts.onChallenge));
  }
  col.append(h, sub, launch);
  root.appendChild(col);

  const side = document.createElement('div');
  side.className = 'home-side';
  side.appendChild(
    renderSessionPlanner({
      onStart: opts.onStartPlanned,
      interleavingSpots: opts.session.interleavingSpots,
      defaultMinutes: opts.session.progression.personalization.schedule?.sessionMinutes ?? null,
    }),
  );
  root.appendChild(side);
  return root;
}
