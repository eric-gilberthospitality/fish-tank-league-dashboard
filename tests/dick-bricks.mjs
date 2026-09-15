import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { i as factory } from '../assets/framework-CXnKph_e.js';
import Award, { validateAwards, summarizeSeason } from '../assets/dick-bricks.js';
import Hub from '../assets/page-CunvdWaO.js';

// Exercise the actual bundled React components without requiring a browser download.
// This checks component wiring, event handlers and data behavior, not visual layout.
const React = factory();
globalThis.window = { location: { hash: '' }, matchMedia: () => ({ matches: true }) };
globalThis.document = { documentElement: { dataset: {} } };
function mount(Component) {
  const cells = [];
  let cursor = 0;
  let effects = [];
  const dispatcher = {
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial;
      return [cells[index], value => { cells[index] = typeof value === 'function' ? value(cells[index]) : value; }];
    },
    useMemo(fn) { return fn(); },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!(index in cells) || deps.some((value, i) => value !== cells[index][i])) {
        cells[index] = deps;
        effects.push(fn);
      }
    }
  };
  return {
    render() {
      cursor = 0;
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = dispatcher;
      try { return Component({}); }
      finally { React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = null; }
    },
    async flush() {
      const pending = effects; effects = [];
      pending.forEach(fn => fn());
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
  };
}
function nodes(tree) {
  if (tree == null || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [tree];
  return [tree, ...nodes(tree.props?.children)];
}
const text = tree => nodes(tree).filter(node => typeof node === 'string' || typeof node === 'number').join(' ');
const find = (tree, predicate) => nodes(tree).find(node => node && typeof node === 'object' && predicate(node));
const row = (season, week, manager, probability = 80) => ({ season, week, manager, team: `${manager} team`, opponent: 'Opponent', winProbability: probability, finalScore: '110–120' });
const awards = [row(2026, 1, 'A'), row(2026, 2, 'A'), row(2026, 3, 'B', 40), row(2027, 1, 'B')];
assert.equal(validateAwards({ awards }).length, 4);
assert.throws(() => validateAwards({ awards: [awards[0], awards[0]] }), /Duplicate/);
assert.throws(() => validateAwards({ awards: [{ ...awards[0], winProbability: null }] }), /Incomplete/);
assert.throws(() => validateAwards({ awards: [{ ...awards[0], winProbability: 101 }] }), /Incomplete/);
assert.deepEqual(summarizeSeason(awards, 2026).leaders.map(row => [row.manager, row.bricks]), [['A', 2], ['B', 1]]);
assert.equal(summarizeSeason(awards, 2027).leaders[0].bricks, 1);
assert.deepEqual(summarizeSeason([row(2026, 1, 'A'), row(2026, 2, 'B')], 2026).leaders.map(row => row.rank), [1, 1]);

const archive = JSON.parse(await readFile(new URL('../data/league.json', import.meta.url)));
globalThis.fetch = async () => ({ ok: true, json: async () => archive });
const hub = mount(Hub);
hub.render(); await hub.flush();
let tree = hub.render();
const nav = nodes(tree).filter(node => node && typeof node === 'object' && node.type === 'button').map(text);
assert.deepEqual(nav.slice(1, 5), ['Overview', 'Standings', 'Dick Bricks', 'Tank Features']);
find(tree, node => node.type === 'button' && text(node) === 'Dick Bricks').props.onClick();
tree = hub.render();
assert.ok(find(tree, node => node.type === Award), 'Navigation must render Award, not the season setter');
find(tree, node => node.type === 'button' && text(node) === 'Tank Features').props.onClick();
tree = hub.render();
assert.match(text(tree), /Tank Features/);
assert.ok(find(tree, node => node.props?.title === 'Dick Brick of the Week'), 'Tank Features must retain the award feature card');

let requests = 0;
globalThis.fetch = async () => { requests++; return { ok: true, json: async () => ({ awards }) }; };
const screen = mount(Award);
assert.match(text(screen.render()), /Loading brick records/);
await screen.flush(); tree = screen.render();
assert.match(text(tree), /A.*2 bricks/);
assert.equal(find(tree, node => node.type === 'img').props.src.endsWith('.jpg'), true, 'Reduced motion uses the still');
find(tree, node => node.type === 'select').props.onChange({ target: { value: '2027' } });
tree = screen.render();
assert.match(text(tree), /2027 SEASON BRICK COUNT/);
assert.doesNotMatch(text(tree), /2 bricks/);
const revisit = mount(Award); revisit.render(); await revisit.flush(); revisit.render();
assert.equal(requests, 1, 'Returning to the tab should reuse the recent data');

const { default: FailedAward } = await import('../assets/dick-bricks.js?error-test');
globalThis.fetch = async () => ({ ok: false, status: 503 });
const failure = mount(FailedAward); failure.render(); await failure.flush(); tree = failure.render();
assert.match(text(tree), /could not be loaded/);
assert.doesNotMatch(text(tree), /No verified bricks/);
globalThis.fetch = async () => ({ ok: true, json: async () => ({ awards: [] }) });
find(tree, node => node.type === 'button' && text(node) === 'Retry').props.onClick();
failure.render(); await failure.flush(); tree = failure.render();
assert.match(text(tree), /No verified bricks recorded/);
assert.doesNotMatch(text(tree), /could not be loaded/);
console.log('Passed: navigation wiring, loading, failures/retry, caching, reduced motion, season totals, ties and duplicate validation.');
