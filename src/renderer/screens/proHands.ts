/**
 * PRO · HANDS: import hand histories and read the leak finder (core/pro/leaks.ts) over them.
 *
 * The renderer names no file: "Choose files…" asks main to open the native dialog, and main answers
 * with counts. The report is main's (gated, computed in a worker); this file only draws it. Nothing
 * here saves the profile, so an import earns nothing: no Reps, no Chalk, no lit day, no Dee reaction.
 * Results are never shown (D10): the report has no money in it to show.
 */

import type { Position } from '../../core/preflop.js';
import { text } from '../components/dom.js';

export interface HandsBridge {
  proImportHands?: () => Promise<unknown>;
  proHandsReport?: () => Promise<unknown>;
  proClearHands?: () => Promise<unknown>;
}

export interface HandsProps {
  readonly bridge: HandsBridge;
  /** Opens the Charts tab: the free surface that drills the chart a spot is held to. */
  readonly onPractise: (position: Position) => void;
}

/** The report as main sends it; read defensively, so a `{ locked }` or a malformed reply draws empty. */
interface SpotView {
  id: string;
  title: string;
  detail: string;
  position: Position;
  n: number;
  k: number;
  you: number | null;
  chart: number;
  band: { low: number; high: number };
  gapPoints: number | null;
  reading: 'leak' | 'band-crosses' | 'under-gap' | 'in-line' | 'not-enough';
  needed: number;
  kind: string;
}
interface ReportView {
  summary: { hands: number; vpip: Ratio; pfr: Ratio; threeBet: Ratio; wtsd: Ratio };
  excluded: number;
  spots: SpotView[];
  meta: { at: string; files: number; sites: string[] } | null;
  /** main's store status: anything but 'ok' means imports are refused until the hands are deleted. */
  status: string;
}
interface Ratio {
  k: number;
  n: number;
}

const SITE_NAMES: Readonly<Record<string, string>> = { pokerstars: 'PokerStars', ggpoker: 'GGPoker', acr: 'ACR' };

const SKIP_WORDS: Readonly<Record<string, string>> = {
  'not-holdem': 'not Hold’em',
  'not-no-limit': 'not no-limit',
  'no-hero-cards': 'no cards dealt to you',
  malformed: 'not readable',
  'too-long': 'too long',
  partial: 'cut off mid-hand',
  'unknown-site': 'not from a supported site',
  link: 'a link',
  'not-a-file': 'not a file',
  'too-large': 'too large',
  'not-text': 'not a text file',
  unreadable: 'could not be read',
  'too-many': 'over the file limit',
  'import-too-large': 'over the import size limit',
};

function parseReport(raw: unknown): ReportView | null {
  if (typeof raw !== 'object' || raw === null || 'locked' in raw) return null;
  const o = raw as { report?: { summary?: ReportView['summary']; spots?: SpotView[]; excluded?: number }; meta?: ReportView['meta']; status?: unknown };
  if (!o.report || !Array.isArray(o.report.spots) || !o.report.summary) return null;
  const status = typeof o.status === 'string' ? o.status : 'ok';
  return { summary: o.report.summary, excluded: Number(o.report.excluded) || 0, spots: o.report.spots, meta: o.meta ?? null, status };
}

const pct = (x: number): string => `${Math.round(x * 100)}`;
const ratio = (r: Ratio): string => (r.n === 0 ? '—' : pct(r.k / r.n));

function readingText(s: SpotView): string {
  switch (s.reading) {
    case 'leak':
      return `Leak · ${s.gapPoints! > 0 ? '+' : '−'}${Math.round(Math.abs(s.gapPoints!))}`;
    case 'band-crosses':
      return 'Band crosses the chart';
    case 'under-gap':
      return 'Under 15 points';
    case 'in-line':
      return 'In line';
    default:
      return s.n === 0 ? 'No hands yet' : `${s.needed} more needed`;
  }
}

/** The one sentence under the table: what the selected spot's numbers say, in words. */
function explain(s: SpotView): string {
  if (s.you === null || s.n === 0) return `${s.title}: no imported hand reached this spot yet.`;
  const action = s.kind === 'open' ? 'open' : s.kind === 'bb-defend' ? 'defend' : 'fold';
  const you = `you ${action} ${pct(s.you)}% (${s.k} of ${s.n}). The chart ${action}s ${pct(s.chart)}%.`;
  if (s.reading === 'not-enough') return `${s.title}: ${you} Under 20 hands nothing is read; ${s.needed} more.`;
  const band = `Your 90% band, ${pct(s.band.low)}–${pct(s.band.high)}%,`;
  switch (s.reading) {
    case 'leak':
      return `${s.title}: ${you} ${band} sits clear of it, so this one is a leak.${s.kind === 'fold-to-3bet' ? ' (The chart’s number assumes its own opening range; open wider and you should fold more.)' : ''}`;
    case 'band-crosses':
      return `${s.title}: ${you} ${band} still reaches the chart, so it could be noise.`;
    case 'under-gap':
      return `${s.title}: ${you} The gap is under 15 points, too small to call a leak.`;
    default:
      return `${s.title}: ${you} ${band} holds the chart: in line.`;
  }
}

const LOCK_ICON =
  '<svg viewBox="0 0 10 11" aria-hidden="true"><path fill="currentColor" d="M2 4.5V3.2a3 3 0 0 1 6 0v1.3h.5c.6 0 1 .4 1 1v4.3c0 .6-.4 1-1 1h-7c-.6 0-1-.4-1-1V5.5c0-.6.4-1 1-1H2Zm1.3 0h3.4V3.2a1.7 1.7 0 0 0-3.4 0v1.3Z"/></svg>';
const IMPORT_ICON =
  '<svg viewBox="0 0 16 18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M9.5 1H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.5L9.5 1ZM8 7v6m-2.5-2.5L8 13l2.5-2.5"/></svg>';

export function renderProHands(props: HandsProps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'pro-hands';
  root.dataset.testid = 'pro-hands';

  // ── Side column: import, the last import, the counting stats, the review-only note ──
  const side = document.createElement('div');
  side.className = 'pro-side';

  const drop = document.createElement('section');
  drop.className = 'pro-import';
  const icon = document.createElement('div');
  icon.className = 'pro-import-icon';
  icon.innerHTML = IMPORT_ICON;
  const local = document.createElement('span');
  local.className = 'pro-local g-caption';
  local.innerHTML = LOCK_ICON;
  local.append('Parsed on this Mac; nothing leaves it.');
  const choose = document.createElement('button');
  choose.type = 'button';
  choose.className = 'pill';
  choose.dataset.testid = 'pro-import';
  choose.textContent = 'Choose files…';
  drop.append(icon, text('div', 't-head', 'Import hand histories'), text('div', 'g-sub', 'PokerStars, GGPoker or ACR text files, or a folder'), local, choose);

  const storeStatus = text('div', 'pro-notice g-caption', '');
  storeStatus.dataset.testid = 'pro-store-status';
  storeStatus.hidden = true;
  const notice = text('div', 'pro-notice g-caption', '');
  notice.dataset.testid = 'pro-import-notice';
  notice.setAttribute('role', 'status');
  notice.hidden = true;

  const last = document.createElement('div');
  last.className = 'pro-last';
  last.dataset.testid = 'pro-last-import';

  const stats = document.createElement('div');
  stats.className = 'pro-stats g-sect';
  stats.dataset.testid = 'pro-stats';

  const reviewOnly = document.createElement('div');
  reviewOnly.className = 'pro-review-only g-caption';
  reviewOnly.dataset.testid = 'pro-review-only';
  reviewOnly.textContent =
    'Real-money hands are for review only. Imports earn no Reps, no Chalk and no lit day; win rate and money are never shown.';

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'pill quiet sm pro-clear';
  clear.dataset.testid = 'pro-clear';
  clear.textContent = 'Delete imported hands';
  clear.hidden = true;

  side.append(drop, storeStatus, notice, last, stats, reviewOnly, clear);

  // ── Main column: leaks by spot ──
  const main = document.createElement('div');
  main.className = 'pro-main';
  const head = document.createElement('div');
  head.className = 'pro-head';
  const titles = document.createElement('div');
  const lede = text('p', 'g-sub pro-lede', 'Your frequencies against Offsuit’s own charts.');
  lede.dataset.testid = 'pro-lede';
  titles.append(text('h2', 't-t2 pro-title', 'Leaks by spot'), lede);
  const legend = document.createElement('div');
  legend.className = 'pro-legend';
  legend.innerHTML = '<span><i class="lg-band"></i>90% band</span><span><i class="lg-dot"></i>You</span><span><i class="lg-tick"></i>Chart</span>';
  head.append(titles, legend);

  const table = document.createElement('div');
  table.className = 'pro-spots';
  table.dataset.testid = 'pro-spots';
  const cols = document.createElement('div');
  cols.className = 'pro-spot-cols g-label';
  cols.append(text('span', '', 'Spot'), text('span', 'num', 'Hands'), text('span', '', '0 – 100%'), text('span', 'num', 'You · chart'), text('span', 'num', 'Reading'));
  const list = document.createElement('div');
  list.className = 'pro-spot-list g-group';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Spots');
  table.append(cols, list);

  const foot = document.createElement('div');
  foot.className = 'pro-foot';
  const sentence = text('p', 'pro-explain', '');
  sentence.dataset.testid = 'pro-explain';
  const practise = document.createElement('button');
  practise.type = 'button';
  practise.className = 'pill primary';
  practise.dataset.testid = 'pro-practise';
  practise.textContent = 'Open the charts';
  foot.append(sentence, practise);
  const method = text('p', 'g-caption pro-method', '');
  method.dataset.testid = 'pro-method';

  const empty = document.createElement('div');
  empty.className = 'pro-empty';
  empty.dataset.testid = 'pro-empty';
  empty.append(
    text('div', 't-t3', 'No hands imported yet'),
    text('p', 'g-sub', 'Export your hand histories from PokerStars, GGPoker or ACR as text, then choose the files or their folder. Offsuit counts how often you open, defend and fold to a 3-bet, against its own charts.'),
  );

  main.append(head, table, foot, method, empty);
  root.append(side, main);

  let selected: string | null = null;

  const paint = (r: ReportView | null): void => {
    const hands = r?.summary.hands ?? 0;
    const has = hands > 0;
    table.hidden = !has;
    foot.hidden = !has;
    method.hidden = !has;
    legend.hidden = !has;
    empty.hidden = has || (r !== null && r.status !== 'ok');
    const stuck = r !== null && r.status !== 'ok';
    clear.hidden = !has && !stuck;
    storeStatus.hidden = !stuck;
    storeStatus.textContent = !stuck
      ? ''
      : r!.status === 'newer'
        ? 'Your imported hands were saved by a newer Offsuit. This one leaves them untouched and cannot show or add to them: update Offsuit, or delete them to start over.'
        : 'Your imported-hands file could not be read whole, so it is left as it is and nothing new is added. Delete imported hands to start over.';
    const excluded = r?.excluded ?? 0;
    method.textContent =
      'Counted, not graded: exact binomial bands against 100bb 6-max cash charts (seats before UTG use UTG’s). Nothing is called a leak under 20 hands or a 15-point gap.' +
      (excluded > 0 ? ` ${excluded.toLocaleString('en-US')} tournament, ante or short-stack hand${excluded === 1 ? ' counts' : 's count'} in the totals only.` : '');
    lede.textContent = has
      ? `Your frequencies against Offsuit’s own charts, counted from ${hands.toLocaleString('en-US')} hands.`
      : 'Your frequencies against Offsuit’s own charts.';

    last.replaceChildren();
    if (r?.meta && has) {
      const when = new Date(r.meta.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const sites = r.meta.sites.map((s) => SITE_NAMES[s] ?? s).join(', ');
      last.append(text('span', 'g-label', 'Last import'), text('span', 'g-caption g-num', `${when} · ${r.meta.files} file${r.meta.files === 1 ? '' : 's'} · ${sites}`));
    }
    last.hidden = !has;

    stats.replaceChildren();
    stats.hidden = !has;
    if (r && has) {
      const stat = (value: string, label: string, testid: string): HTMLElement => {
        const el = document.createElement('div');
        el.className = 'g-stat';
        el.dataset.testid = testid;
        el.append(text('span', 't-t3 g-num', value), text('span', 'g-label', label));
        return el;
      };
      const s = r.summary;
      stats.append(
        stat(hands.toLocaleString('en-US'), 'hands', 'pro-stat-hands'),
        stat(`${ratio(s.vpip)} / ${ratio(s.pfr)}`, 'VPIP / PFR', 'pro-stat-vpip'),
        stat(ratio(s.threeBet), '3-bet %', 'pro-stat-3bet'),
        stat(ratio(s.wtsd), 'WTSD %', 'pro-stat-wtsd'),
      );
    }

    list.replaceChildren();
    if (!r || !has) return;
    if (selected === null || !r.spots.some((s) => s.id === selected)) selected = r.spots[0]?.id ?? null;
    for (const s of r.spots) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'pro-spot';
      row.dataset.testid = 'pro-spot';
      row.dataset.spot = s.id;
      row.dataset.reading = s.reading;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(s.id === selected));
      const name = document.createElement('span');
      name.className = 'pro-spot-name';
      name.append(text('span', 'pro-spot-title', s.title), text('span', 'g-caption', s.detail));
      const bar = document.createElement('span');
      bar.className = 'pro-bar';
      bar.dataset.empty = String(s.you === null || s.n < 20);
      if (s.you !== null && s.n >= 20) {
        const band = document.createElement('i');
        band.className = 'pro-bar-band';
        band.style.left = `${s.band.low * 100}%`;
        band.style.width = `${(s.band.high - s.band.low) * 100}%`;
        const dot = document.createElement('i');
        dot.className = 'pro-bar-dot';
        dot.style.left = `${s.you * 100}%`;
        bar.append(band, dot);
      }
      const tick = document.createElement('i');
      tick.className = 'pro-bar-tick';
      tick.style.left = `${s.chart * 100}%`;
      bar.append(tick);
      const vs = document.createElement('span');
      vs.className = 'num g-num pro-vs';
      if (s.you === null) vs.textContent = '—';
      else vs.append(text('b', '', pct(s.you)), ` · ${pct(s.chart)}`);
      const reading = text('span', 'num pro-reading', readingText(s));
      reading.dataset.testid = 'pro-reading';
      row.append(name, text('span', 'num g-num', String(s.n)), bar, vs, reading);
      row.addEventListener('click', () => {
        selected = s.id;
        for (const other of list.querySelectorAll('.pro-spot')) other.setAttribute('aria-selected', String(other === row));
        paintFoot(r);
      });
      list.appendChild(row);
    }
    paintFoot(r);
  };

  const paintFoot = (r: ReportView): void => {
    const s = r.spots.find((x) => x.id === selected);
    if (!s) return;
    sentence.textContent = explain(s);
    practise.onclick = () => props.onPractise(s.position === 'BB' ? 'BB' : s.position);
  };

  const load = async (): Promise<void> => {
    paint(parseReport(await props.bridge.proHandsReport?.().catch(() => null)));
  };

  choose.addEventListener('click', async () => {
    choose.disabled = true;
    try {
      const raw = (await props.bridge.proImportHands?.().catch(() => ({ failed: true }))) as Record<string, unknown> | undefined;
      if (raw?.failed === true) {
        showNotice('The import failed, so nothing was added. Your imported hands are as they were.');
        return;
      }
      if (raw?.refused === 'store-unreadable') {
        showNotice('Nothing was added: your imported hands are kept as they are (see above). Delete them to start over.');
        return;
      }
      if (!raw || 'locked' in raw || raw.canceled === true) return;
      if (raw.busy === true) {
        showNotice('An import is already running.');
        return;
      }
      const words = (counts: unknown): string[] =>
        Object.entries((counts ?? {}) as Record<string, number>).map(([k, v]) => `${v} ${SKIP_WORDS[k] ?? k}`);
      const parts = [`Added ${Number(raw.added)} hand${raw.added === 1 ? '' : 's'} from ${Number(raw.files)} file${raw.files === 1 ? '' : 's'}.`];
      if (Number(raw.duplicates) > 0) parts.push(`${Number(raw.duplicates)} already imported.`);
      const skipped = [...words(raw.handsSkipped), ...words(raw.filesSkipped)];
      if (skipped.length > 0) parts.push(`Skipped: ${skipped.join(', ')}.`);
      if (Number(raw.overCap) > 0) parts.push(`${Number(raw.overCap)} not kept: the store is full.`);
      if (Number(raw.tooLarge) > 0) parts.push(`${Number(raw.tooLarge)} too large to be a real hand.`);
      showNotice(parts.join(' '));
      await load();
    } finally {
      choose.disabled = false;
    }
  });

  let confirming = false;
  clear.addEventListener('click', async () => {
    if (!confirming) {
      confirming = true;
      clear.textContent = 'Delete them all? This cannot be undone';
      clear.dataset.confirm = 'true';
      return;
    }
    confirming = false;
    clear.textContent = 'Delete imported hands';
    clear.dataset.confirm = 'false';
    const out = (await props.bridge.proClearHands?.().catch(() => ({ failed: true }))) as Record<string, unknown> | undefined;
    if (out?.busy === true) showNotice('An import is running; delete the hands when it has finished.');
    else if (out?.cleared === true) showNotice('Imported hands deleted. Your profile is unchanged.');
    else showNotice('The hands could not be deleted. Nothing was changed.');
    await load();
  });

  function showNotice(message: string): void {
    notice.textContent = message;
    notice.hidden = false;
  }

  paint(null);
  void load();
  return root;
}
