/**
 * Browser save keys. The game was called Zombie Invasion Defense ("zid") before
 * it became Zombies vs Heavy Metal ("zvhm"); older saves are copied across once
 * so nobody loses Salvage, survivors, tutorial progress or settings.
 */

export const SAVE_PREFIX = "zvhm.";
export const OLD_SAVE_PREFIX = "zid.";
export const SAVE_KEYS = ["salvage", "survivors", "tutorial", "sound", "ranges"] as const;
export type SaveKey = (typeof SAVE_KEYS)[number];

export function saveKey(key: SaveKey): string {
  return SAVE_PREFIX + key;
}

/**
 * Copy each old-name save to the new name where the new one is missing.
 * Old keys are left in place (harmless, and a safe way back). Returns the keys copied.
 */
export function migrateSaves(store: Pick<Storage, "getItem" | "setItem">): SaveKey[] {
  const moved: SaveKey[] = [];
  for (const key of SAVE_KEYS) {
    const old = store.getItem(OLD_SAVE_PREFIX + key);
    if (old === null || store.getItem(SAVE_PREFIX + key) !== null) continue;
    store.setItem(SAVE_PREFIX + key, old);
    moved.push(key);
  }
  return moved;
}
