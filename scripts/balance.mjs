// Deterministic balance report. Runs scripted players across many seeds and
// reports survival, enemy counts, stronghold damage, supplies and difficulty
// steps per wave. Usage (after `npm run build` or `npm test`):
//   node scripts/balance.mjs [seeds=24]
import { baseConfig as cfg } from "../dist/games/zid/config.js";
import { buildOnlyPlayer, passivePlayer, playRun, sensiblePlayer } from "../dist/games/zid/bots.js";
import { wavePlan, waveThreat } from "../dist/games/zid/waves.js";

const SEEDS = Number(process.argv[2] ?? 24);
const MAX_WAVE = 40;
const players = { sensible: sensiblePlayer, buildOnly: buildOnlyPlayer, passive: passivePlayer };

const median = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return (b[(b.length - 1) >> 1] + b[b.length >> 1]) / 2;
};

console.log(`Seeds: ${SEEDS}. Target: typical defeat between wave ${cfg.balance.typicalDefeatWaveMin} and ${cfg.balance.typicalDefeatWaveMax}.`);
const runsBy = {};
for (const [name, player] of Object.entries(players)) {
  const runs = [];
  for (let seed = 1; seed <= SEEDS; seed++) runs.push(playRun(cfg, seed, player, MAX_WAVE));
  runsBy[name] = runs;
  const d = runs.map((r) => r.defeatWave ?? MAX_WAVE + 1);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  console.log(`${name.padEnd(9)} defeat wave median ${median(d)}  mean ${mean.toFixed(1)}  range ${Math.min(...d)}-${Math.max(...d)}  survived wave ${MAX_WAVE}: ${runs.filter((r) => r.defeatWave === null).length}`);
}

const rows = [];
let prev = null;
for (let w = 1; w <= 20; w++) {
  const p = wavePlan(cfg, w);
  const threat = waveThreat(cfg, w);
  const entries = runsBy.sensible.map((r) => r.perWave.find((x) => x.wave === w)).filter(Boolean);
  rows.push({
    wave: w,
    enemies: p.count,
    walkers: Math.round(p.count * p.mix.walker),
    runners: Math.round(p.count * p.mix.runner),
    brutes: Math.round(p.count * p.mix.brute),
    hpX: p.hpMultiplier.toFixed(2),
    threat: Math.round(threat),
    threatStep: prev ? `${((threat / prev - 1) * 100).toFixed(1)}%` : "",
    reached: entries.length,
    meanDamage: entries.length ? Math.round(entries.reduce((a, e) => a + e.damage, 0) / entries.length) : "",
    meanSupplies: entries.length ? Math.round(entries.reduce((a, e) => a + e.supplies, 0) / entries.length) : "",
  });
  prev = threat;
}
console.table(rows);
