/** Small flow helpers shared by the node screens. */
import type { AppCtx } from '../types';

/** Mark the current non-battle node done if the run layer has not already (idempotent). */
export function leaveIfOpen(app: AppCtx): void {
  const run = app.run;
  if (!run || !run.currentNode || run.nodesDone.includes(run.currentNode)) return;
  app.guard('leaveNode', () => app.api.leaveNode(run));
}
