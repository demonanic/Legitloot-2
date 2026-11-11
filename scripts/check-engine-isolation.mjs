// Fails if engine code imports from a game or names game-specific concepts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const banned = /\b(zombie|walker|runner|brute|turret|barricade|stronghold|currency|supplies|salvage|lootcoin)s?\b/i;
const problems = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) {
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (/from\s+["'][^"']*games\//.test(line)) problems.push(`${p}:${i + 1} imports from games/`);
        const m = line.match(banned);
        if (m) problems.push(`${p}:${i + 1} mentions "${m[0]}"`);
      });
    }
  }
}
walk("engine");
if (problems.length) {
  console.error("Engine isolation check failed:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("Engine isolation check passed");
