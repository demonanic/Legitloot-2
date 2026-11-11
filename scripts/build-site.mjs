// Assemble the static site: public/ + compiled engine and game code (no tests).
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

rmSync("site", { recursive: true, force: true });
mkdirSync("site", { recursive: true });
cpSync("public", "site", { recursive: true });
for (const dir of ["engine", "games"]) {
  cpSync(`dist/${dir}`, `site/${dir}`, { recursive: true, filter: (src) => !src.endsWith(".map") });
}
// GitHub Pages: serve files as-is.
writeFileSync("site/.nojekyll", "");
console.log("site/ ready");
