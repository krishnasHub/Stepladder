/**
 * Runs the finishability check off the main thread, so painting never lags.
 * The editor starts a fresh worker per check and simply terminates it when the
 * level changes, which is the whole cancellation story.
 */
import { solve } from './solver';

self.onmessage = (e: MessageEvent<{ rows: string[] }>) => {
  const result = solve(e.data.rows, (p) => self.postMessage(p));
  self.postMessage(result);
};
