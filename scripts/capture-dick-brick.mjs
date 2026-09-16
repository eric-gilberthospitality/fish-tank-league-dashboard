import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ledgerPath = resolve(root, 'data/dick-bricks.json');
const snapshotsPath = resolve(root, 'data/dick-brick-snapshots.json');
const leagueId = process.env.ESPN_LEAGUE_ID || '791101930';
const season = Number(process.env.ESPN_SEASON || new Date().getFullYear());
const mode = process.argv[2] || 'auto';
const nyFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });

async function json(path, fallback) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }
async function writeJson(path, value) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }
function nyParts(date) { return Object.fromEntries(nyFormatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value])); }
function espnHeaders() {
  const cookies = [`espn_s2=${process.env.ESPN_S2 || ''}`, `SWID=${process.env.ESPN_SWID || ''}`].filter(cookie => !cookie.endsWith('='));
  return {
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://fantasy.espn.com/',
    'User-Agent': 'Mozilla/5.0 (compatible; FishTankLeagueHub/1.0)',
    ...(cookies.length ? { Cookie: cookies.join('; ') } : {})
  };
}
async function fetchJson(url, authenticated = false) {
  const response = await fetch(url, { headers: authenticated ? espnHeaders() : { Accept: 'application/json, text/plain, */*' } });
  const body = await response.text();
  const host = new URL(url).hostname;
  if (!response.ok) throw new Error(`${response.status} from ${host}`);
  if (!body.trim()) throw new Error(`${host} returned an empty response. Refresh the ESPN_S2 and ESPN_SWID repository secrets, then run Verify ESPN access again.`);
  try { return JSON.parse(body); }
  catch { throw new Error(`${host} returned a non-JSON response (${response.headers.get('content-type') || 'unknown content type'}). Refresh the ESPN_S2 and ESPN_SWID repository secrets, then run Verify ESPN access again.`); }
}

export function projectedWinProbability(teamProjection, opponentProjection) {
  // A 12-point live projection edge corresponds to a 73% pre-MNF win chance.
  const difference = Number(teamProjection) - Number(opponentProjection);
  return Math.round((100 / (1 + Math.exp(-difference / 12))) * 10) / 10;
}
export function awardCandidate(snapshot, finalSchedule) {
  const finalById = new Map(finalSchedule.map(matchup => [matchup.id, matchup]));
  const candidates = [];
  for (const matchup of snapshot.matchups) {
    const final = finalById.get(matchup.id);
    if (!final || !['HOME', 'AWAY'].includes(final.winner)) return null;
    const loser = final.winner === 'HOME' ? matchup.away : matchup.home;
    const winner = final.winner === 'HOME' ? matchup.home : matchup.away;
    const winnerFinal = final.winner === 'HOME' ? final.home : final.away;
    const loserFinal = final.winner === 'HOME' ? final.away : final.home;
    candidates.push({ ...loser, opponent: winner.team, finalScore: `${Number(loserFinal.totalPoints).toFixed(2)}–${Number(winnerFinal.totalPoints).toFixed(2)}` });
  }
  return candidates.sort((a, b) => b.winProbability - a.winProbability || b.projectedPoints - a.projectedPoints || a.manager.localeCompare(b.manager))[0];
}
async function getFirstMondayKickoff(now) {
  const date = nyParts(now);
  if (date.weekday !== 'Monday') return null;
  const games = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${date.year}${date.month}${date.day}&limit=1000`);
  return (games.events || []).map(event => new Date(event.date)).filter(value => Number.isFinite(value.valueOf())).sort((a, b) => a - b)[0] || null;
}
async function leagueScoreboard(requestedWeek, includeBoxscore = false) {
  const query = new URLSearchParams();
  for (const view of ['mMatchupScore', 'mTeams', 'mSettings', ...(includeBoxscore ? ['mBoxscore'] : [])]) query.append('view', view);
  if (requestedWeek) { query.set('matchupPeriodId', requestedWeek); query.set('scoringPeriodId', requestedWeek); }
  const payload = await fetchJson(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?${query}`, true);
  const week = Number(requestedWeek || payload.status?.currentMatchupPeriod || payload.scoringPeriodId);
  if (!Number.isInteger(week) || week < 1) throw new Error('ESPN did not return a current matchup period');
  const members = new Map((payload.members || []).map(member => [String(member.id), member.displayName || [member.firstName, member.lastName].filter(Boolean).join(' ') || 'Manager']));
  const teams = new Map((payload.teams || []).map(team => [team.id, { managerId: String(team.owners?.[0] || team.id), manager: members.get(String(team.owners?.[0])) || `Team ${team.id}`, team: [team.location, team.nickname].filter(Boolean).join(' ') || `Team ${team.id}` }]));
  return { week, teams, schedule: (payload.schedule || []).filter(matchup => matchup.matchupPeriodId === week && matchup.home && matchup.away) };
}
function activeEntries(side) { return (side.rosterForCurrentScoringPeriod?.entries || []).filter(entry => ![20, 21].includes(entry.lineupSlotId)); }
// ESPN rewrites historical statSourceId:0 projections after a matchup ends.  Do
// not use that field for a backfill: it is then a final-stat lookalike, not a
// pre-kickoff forecast.  This helper only reconstructs the verifiable lineup
// and score state for a retrospective review.
export function sideAtKickoffReview(side, team, kickoffByProTeam, kickoff) {
  let pointsScored = 0;
  const remainingPlayers = [];
  const unmatchedPlayers = [];
  for (const entry of activeEntries(side)) {
    const player = entry.playerPoolEntry?.player || {};
    const playerKickoff = kickoffByProTeam.get(String(player.proTeamId));
    if (!playerKickoff) { unmatchedPlayers.push(player.fullName || `Player ${player.id}`); continue; }
    const finalPoints = Number(entry.playerPoolEntry?.appliedStatTotal ?? 0);
    if (playerKickoff >= kickoff) remainingPlayers.push({ name: player.fullName || `Player ${player.id}`, proTeamId: String(player.proTeamId), finalPoints: Math.round(finalPoints * 100) / 100 });
    else pointsScored += finalPoints;
  }
  return { ...team, pointsScored: Math.round(pointsScored * 100) / 100, remainingPlayers, unmatchedPlayers };
}
async function weekKickoffs(week) {
  const payload = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}&limit=1000`);
  const events = (payload.events || []).map(event => ({ date: new Date(event.date), teams: event.competitions?.[0]?.competitors?.map(competitor => String(competitor.team?.id)) || [] })).filter(event => Number.isFinite(event.date.valueOf()));
  const firstMnfKickoff = events.map(event => event.date).filter(date => nyParts(date).weekday === 'Monday').sort((a, b) => a - b)[0];
  if (!firstMnfKickoff) throw new Error(`No Monday Night Football kickoff found for Week ${week}`);
  return { firstMnfKickoff, kickoffByProTeam: new Map(events.flatMap(event => event.teams.map(teamId => [teamId, event.date]))) };
}
function projectedSide(side, details, opponent) {
  const projectedPoints = Number(side.totalProjectedPointsLive ?? side.totalPoints ?? 0);
  const opponentProjectedPoints = Number(opponent.totalProjectedPointsLive ?? opponent.totalPoints ?? 0);
  return { ...details, projectedPoints, totalPointsAtCapture: Number(side.totalPoints ?? 0), winProbability: projectedWinProbability(projectedPoints, opponentProjectedPoints) };
}
async function capture(now) {
  const kickoff = await getFirstMondayKickoff(now);
  if (!kickoff) return { changed: false, message: 'No Monday Night Football kickoff today.' };
  const minutesUntilKickoff = (kickoff - now) / 60000;
  if (minutesUntilKickoff > 15 || minutesUntilKickoff <= 0) return { changed: false, message: `Capture window is closed (${minutesUntilKickoff.toFixed(1)} minutes to kickoff).` };
  const { week, teams, schedule } = await leagueScoreboard();
  const snapshots = await json(snapshotsPath, { snapshots: [] });
  if (snapshots.snapshots.some(snapshot => snapshot.season === season && snapshot.week === week)) return { changed: false, message: `Week ${week} already captured.` };
  const matchups = schedule.map(matchup => ({ id: matchup.id, home: projectedSide(matchup.home, teams.get(matchup.home.teamId), matchup.away), away: projectedSide(matchup.away, teams.get(matchup.away.teamId), matchup.home) }));
  if (!matchups.length) throw new Error('ESPN returned no current matchups');
  snapshots.snapshots.push({ season, week, capturedAt: now.toISOString(), firstMnfKickoff: kickoff.toISOString(), matchups });
  snapshots.snapshots.sort((a, b) => a.season - b.season || a.week - b.week);
  await writeJson(snapshotsPath, snapshots);
  return { changed: true, message: `Captured Week ${week} ${minutesUntilKickoff.toFixed(1)} minutes before kickoff.` };
}
async function finalize() {
  const snapshots = await json(snapshotsPath, { snapshots: [] });
  const open = snapshots.snapshots.filter(snapshot => !snapshot.finalizedAt);
  if (!open.length) return { changed: false, message: 'No captured weeks awaiting final scores.' };
  const { week, schedule } = await leagueScoreboard();
  const ledger = await json(ledgerPath, { definition: 'Awarded to the losing team with the highest projection-based win probability before Monday Night Football.', capturePoint: 'Captured immediately before the first Monday Night Football kickoff.', awards: [] });
  let changed = false;
  for (const snapshot of open.filter(snapshot => snapshot.season === season && snapshot.week === week)) {
    const award = awardCandidate(snapshot, schedule);
    if (!award) continue;
    if (!ledger.awards.some(row => row.season === snapshot.season && row.week === snapshot.week)) {
      ledger.awards.push({ season: snapshot.season, week: snapshot.week, managerId: award.managerId, manager: award.manager, team: award.team, opponent: award.opponent, winProbability: award.winProbability, finalScore: award.finalScore, capturedAt: snapshot.capturedAt });
      changed = true;
    }
    snapshot.finalizedAt = new Date().toISOString(); snapshot.awardManager = award.manager; changed = true;
  }
  if (changed) { ledger.awards.sort((a, b) => b.season - a.season || b.week - a.week); await writeJson(ledgerPath, ledger); await writeJson(snapshotsPath, snapshots); }
  return { changed, message: changed ? 'Finalized available Dick Brick award(s).' : 'Current week is not final yet.' };
}
async function verify() {
  const { week, schedule } = await leagueScoreboard();
  if (!schedule.length) throw new Error('ESPN returned no matchups for the current week');
  return { changed: false, message: `Verified ESPN access for Week ${week}: ${schedule.length} matchup(s) available.` };
}
async function backfill(week = 1) {
  const { teams, schedule } = await leagueScoreboard(week, true);
  if (!schedule.length) throw new Error(`ESPN returned no Week ${week} matchups`);
  const { firstMnfKickoff, kickoffByProTeam } = await weekKickoffs(week);
  const matchups = schedule.map(matchup => {
    const home = sideAtKickoffReview(matchup.home, teams.get(matchup.home.teamId), kickoffByProTeam, firstMnfKickoff);
    const away = sideAtKickoffReview(matchup.away, teams.get(matchup.away.teamId), kickoffByProTeam, firstMnfKickoff);
    return {
      id: matchup.id,
      home: { ...home, finalScore: Number(matchup.home.totalPoints ?? 0) },
      away: { ...away, finalScore: Number(matchup.away.totalPoints ?? 0) }
    };
  });
  if (matchups.some(matchup => matchup.home.unmatchedPlayers.length || matchup.away.unmatchedPlayers.length)) throw new Error('ESPN did not map every active player to an NFL kickoff; the Week 1 estimate cannot be verified.');
  console.log(JSON.stringify({
    method: 'retrospective lineup and score review; historical ESPN projections are intentionally excluded because ESPN replaces them after finalization',
    week,
    firstMnfKickoff: firstMnfKickoff.toISOString(),
    matchups
  }, null, 2));
  return { changed: false, message: `Reported a Week ${week} lineup and score review. Add any historical forecasts from an external dated source before recording an award.` };
}
async function main() {
  if (!process.env.ESPN_S2 || !process.env.ESPN_SWID) { console.log('Skipping capture: ESPN_S2 and ESPN_SWID are not configured.'); return; }
  const results = [];
  if (mode === 'verify') results.push(await verify());
  if (mode === 'backfill') results.push(await backfill(1));
  if (mode === 'auto' || mode === 'capture') results.push(await capture(new Date()));
  if (mode === 'auto' || mode === 'finalize') results.push(await finalize());
  for (const result of results) console.log(result.message);
}
if (process.argv[1] === new URL(import.meta.url).pathname) main().catch(error => { console.error(error); process.exitCode = 1; });
