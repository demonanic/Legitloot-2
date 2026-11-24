/**
 * Run reporting to the LegitLoot portal page that embeds the game.
 *
 * When the game runs inside legitloot.site's game page, it posts each run's
 * progress to the parent window: a "run-start" when a run begins, a
 * "checkpoint" after every cleared wave, and a "run-end" on defeat. The portal
 * page decides what to do with them (award tracking for signed-in players).
 * Played on its own, nothing is sent.
 *
 * Totals are per run and only ever go up. The portal's server checks them
 * against its own clock, so nothing here is trusted for awards on its own.
 */
import type { GameState } from "./sim.js";

export const PORTAL_ORIGIN = "https://legitloot.site";
export const PORTAL_GAME = "zvhm";
export const PORTAL_MESSAGE_TYPE = "legitloot:game";

export interface PortalStats {
  waves_cleared: number;
  kills: number;
  bosses_killed: number;
}

export type PortalEvent = "run-start" | "checkpoint" | "run-end";

export interface PortalMessage {
  type: typeof PORTAL_MESSAGE_TYPE;
  version: 1;
  game: typeof PORTAL_GAME;
  event: PortalEvent;
  clientVersion?: string;
  stats?: PortalStats;
}

const whole = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function portalStats(s: Pick<GameState, "wavesCleared" | "kills" | "bossesKilled">): PortalStats {
  return { waves_cleared: whole(s.wavesCleared), kills: whole(s.kills), bosses_killed: whole(s.bossesKilled) };
}

/**
 * Call `update(state)` after every simulation step. A new state object means a
 * new run. Sends at most one message per cleared wave plus start and end.
 */
export function createPortalReporter(post: (m: PortalMessage) => void, clientVersion: string) {
  let run: GameState | null = null;
  let wavesSent = 0;
  let ended = false;
  const base = { type: PORTAL_MESSAGE_TYPE, version: 1, game: PORTAL_GAME } as const;
  return {
    update(s: GameState): void {
      if (s !== run) {
        run = s;
        wavesSent = s.wavesCleared;
        ended = false;
        post({ ...base, event: "run-start", clientVersion });
      }
      if (ended) return;
      if (s.phase === "lost") {
        ended = true;
        post({ ...base, event: "run-end", stats: portalStats(s) });
      } else if (s.wavesCleared > wavesSent) {
        wavesSent = s.wavesCleared;
        post({ ...base, event: "checkpoint", stats: portalStats(s) });
      }
    },
  };
}

export const PORTAL_READY_TYPE = "legitloot:portal";
/** Messages held while waiting for the portal page to say it is listening. */
export const PORTAL_QUEUE_LIMIT = 200;

type PortalWindow = Pick<Window, "parent" | "addEventListener">;

/**
 * The poster for an embedded game, or null when the game is not inside another page.
 * The parent page may still be loading when the game starts, so messages are held
 * until legitloot.site posts {type: "legitloot:portal", event: "ready"}, then sent in order.
 */
export function parentPoster(win: PortalWindow): ((m: PortalMessage) => void) | null {
  if (win.parent === (win as unknown)) return null;
  let ready = false;
  const queue: PortalMessage[] = [];
  const send = (m: PortalMessage): void => {
    try {
      // Delivered only if the parent page is legitloot.site.
      win.parent.postMessage(m, PORTAL_ORIGIN);
    } catch {
      // Reporting is best effort; the game never depends on it.
    }
  };
  win.addEventListener("message", (event: MessageEvent) => {
    if (ready || event.origin !== PORTAL_ORIGIN || event.source !== win.parent) return;
    const d = event.data as { type?: unknown; event?: unknown } | null;
    if (!d || d.type !== PORTAL_READY_TYPE || d.event !== "ready") return;
    ready = true;
    for (const m of queue.splice(0)) send(m);
  });
  return (m) => {
    if (ready) send(m);
    else if (queue.length < PORTAL_QUEUE_LIMIT) queue.push(m);
  };
}
