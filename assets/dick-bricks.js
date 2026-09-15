import { r as wrap } from './rolldown-runtime-S-ySWqyJ.js';
import { i as reactFactory } from './framework-CXnKph_e.js';

const React = wrap(reactFactory(), 1);
const h = React.createElement;
const base = '/fish-tank-league-dashboard/';
let cachedRequest;
let cachedAt = 0;

export function validateAwards(data) {
  if (!data || !Array.isArray(data.awards)) throw new Error('Invalid award ledger');
  const weeks = new Set();
  for (const award of data.awards) {
    if (!award || !Number.isInteger(award.season) || award.season < 2026 ||
        !Number.isInteger(award.week) || award.week < 1 || award.week > 18 ||
        !Number.isFinite(award.winProbability) || award.winProbability < 0 || award.winProbability > 100 ||
        !['manager', 'team', 'opponent', 'finalScore'].every(key => typeof award[key] === 'string' && award[key].trim())) {
      throw new Error('Incomplete award record');
    }
    const key = `${award.season}:${award.week}`;
    if (weeks.has(key)) throw new Error('Duplicate weekly award');
    weeks.add(key);
  }
  return data.awards;
}

function loadAwards() {
  if (!cachedRequest || Date.now() - cachedAt > 60000) {
    cachedAt = Date.now();
    cachedRequest = fetch(`${base}data/dick-bricks.json`, { cache: 'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error('Award ledger unavailable');
        return response.json();
      }).then(validateAwards).catch(error => {
        cachedRequest = null;
        throw error;
      });
  }
  return cachedRequest;
}

export function summarizeSeason(awards, season) {
  const receipts = awards.filter(row => row.season === season).sort((a, b) => b.week - a.week);
  const managers = new Map();
  for (const row of receipts) {
    // Stable IDs can be supplied by the league sync; manager labels are the manual-entry fallback.
    const key = row.managerId || row.manager;
    if (!managers.has(key)) managers.set(key, { key, manager: row.manager, team: row.team, bricks: 0 });
    managers.get(key).bricks++;
  }
  const leaders = [...managers.values()].sort((a, b) => b.bricks - a.bricks || a.manager.localeCompare(b.manager));
  let rank = 0;
  for (let i = 0; i < leaders.length; i++) {
    if (i === 0 || leaders[i].bricks !== leaders[i - 1].bricks) rank = i + 1;
    leaders[i].rank = rank;
  }
  return { receipts, leaders };
}

export default function DickBrickAward() {
  const [awards, setAwards] = React.useState(null);
  const [error, setError] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [selectedSeason, setSelectedSeason] = React.useState(2026);
  const [animate, setAnimate] = React.useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  React.useEffect(() => {
    let active = true;
    setError(false);
    loadAwards().then(rows => {
      if (active) setAwards(rows);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attempt]);
  const seasons = React.useMemo(() => [...new Set([2026, ...(awards || []).map(row => row.season)])].sort((a, b) => b - a), [awards]);
  const { receipts, leaders } = React.useMemo(() => summarizeSeason(awards || [], selectedSeason), [awards, selectedSeason]);

  let board;
  if (error) board = h('div', { className: 'empty', role: 'alert' },
    h('b', null, 'Brick records could not be loaded'),
    h('p', null, 'Try again to see the verified totals.'),
    h('button', { onClick: () => setAttempt(value => value + 1) }, 'Retry'));
  else if (awards === null) board = h('p', { role: 'status' }, 'Loading brick records…');
  else if (!leaders.length) board = h('div', { className: 'empty' },
    h('b', null, 'No verified bricks recorded'),
    h('p', null, 'Weekly recipients appear here once their pre-MNF probabilities and final results are recorded.'));
  else board = h('ol', { className: 'brick-leaders', 'aria-label': `${selectedSeason} brick leaderboard` },
    leaders.map(row => h('li', { className: 'leader', key: row.key },
      h('span', null, row.rank), h('b', null, row.manager, h('small', null, row.team)),
      h('em', null, `${row.bricks} ${row.bricks === 1 ? 'brick' : 'bricks'}`))));

  return h('section', { className: 'page bricks' },
    h('div', { className: 'page-title' },
      h('div', null, h('p', { className: 'eyebrow' }, 'THE WEEKLY SHAME'),
        h('h1', null, 'Dick Brick of the Week'),
        h('p', null, 'Among the teams that lost, the brick goes to the team with the highest win probability immediately before the first Monday Night Football kickoff.')),
      h('label', { className: 'brick-season' }, 'Season',
        h('select', { value: selectedSeason, onChange: event => setSelectedSeason(Number(event.target.value)) },
          seasons.map(season => h('option', { value: season, key: season }, season))))),
    h('section', { className: 'brick-grid' },
      h('article', { className: 'brick-showcase' },
        h('img', { src: `${base}assets/dick-brick.${animate ? 'webp' : 'jpg'}`, width: 220, height: 271,
          decoding: 'async', alt: 'Dick Brick of the Week award' }),
        h('button', { className: 'brick-animation', onClick: () => setAnimate(value => !value), 'aria-pressed': animate }, animate ? 'Pause animation' : 'Play animation'),
        h('h2', null, 'Hold this.'), h('p', null, 'Monday had other plans. The brick is yours.')),
      h('article', null, h('p', { className: 'eyebrow' }, `${selectedSeason} SEASON BRICK COUNT`), board)),
    !error && receipts.length > 0 && h('article', { className: 'brick-history' },
      h('h2', { className: 'eyebrow' }, 'BRICK RECEIPTS'),
      h('div', { className: 'table-card', tabIndex: 0, role: 'region', 'aria-label': 'Weekly brick receipts' },
        h('table', null,
          h('thead', null, h('tr', null, ['Week', 'Recipient', 'Opponent', 'Win % at MNF', 'Final score'].map(label => h('th', { scope: 'col', key: label }, label)))),
          h('tbody', null, receipts.map(row => h('tr', { key: row.week },
            h('td', null, `W${row.week}`), h('td', null, h('b', null, row.team), h('small', null, row.manager)),
            h('td', null, row.opponent), h('td', { className: 'minus' }, `${row.winProbability}%`), h('td', null, row.finalScore))))))),
    h('p', { className: 'brick-rule' }, 'One brick per week. Season totals count recorded awards only. A Monday-night capture records ESPN live projections and derives each probability.'));
}
