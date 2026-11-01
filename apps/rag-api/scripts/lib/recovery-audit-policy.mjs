/** Pure policy: no automatic side-effect replay, no cross-store false positives. */
export function assessRun(run, { nowMs, staleMs, hasCheckpoint, cancelSignalPresent }) {
  const findings = [];
  const age = nowMs - new Date(run.updatedAt).getTime();
  const state = run.status;
  if (!Number.isFinite(age)) return [{severity:'error',code:'invalid_run_timestamp'}];
  if (state === 'running' && age > staleMs) findings.push({severity:'critical', code:'stale_run_manual_reconciliation'});
  if (run.cancelSignalPending === true) findings.push({severity:'warning', code:'cancel_signal_pending', action:'retry existing delivery mechanism; do not rerun tools'});
  if (state === 'waiting_approval' && run.mode === 'agentic' && hasCheckpoint === false) findings.push({severity:'critical',code:'approval_checkpoint_missing_manual_reconciliation'});
  if (state === 'failed' && run.cancelSignalPending === false && cancelSignalPresent === false && age > staleMs) {
    // Historical failures need not have a cancel signal. Never infer missing state.
  }
  return findings;
}
