/**
 * Runs the finishability check off the main thread, so painting never lags.
 *
 * First the portal, once per Tuffling; then, if the level has a trophy, the
 * trophy, once per Tuffling. Every message is tagged with who and what it is
 * about. The editor starts a fresh worker per check and simply terminates it
 * when the level changes, which is the whole cancellation story.
 */
import { TUFFLING_IDS } from '../abilities';
import { solve } from './solver';

self.onmessage = (e: MessageEvent<{ rows: string[] }>) => {
  const rows = e.data.rows;
  const aims = rows.some((r) => r.includes('C')) ? (['portal', 'trophy'] as const) : (['portal'] as const);
  for (const aim of aims) {
    for (const tuffling of TUFFLING_IDS) {
      const result = solve(rows, tuffling, (p) => self.postMessage({ ...p, tuffling, aim }), aim);
      self.postMessage({ ...result, tuffling, aim });
    }
  }
};
