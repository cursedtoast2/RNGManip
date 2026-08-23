import { History, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ATTEMPT_HISTORY_LIMIT,
  attemptPressJudgment,
  clearAttemptHistory,
  formatAttemptPress,
  formatAttemptTime,
  loadAttemptHistory,
  subscribeAttemptHistory,
  type AttemptRecord,
  type AttemptTool,
} from "../engine/attemptHistory";

export default function AttemptHistory({ tool }: { tool: AttemptTool }) {
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<AttemptRecord[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dialog = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const sync = () => setRecords(loadAttemptHistory(tool));
    sync();
    return subscribeAttemptHistory(sync);
  }, [tool]);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    setConfirmClear(false);
    dialog.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [close, open]);

  return (
    <>
      <button ref={trigger} type="button" className="history-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <History aria-hidden="true" /> Attempt history
      </button>
      {open && createPortal(
        <div className="history-modal">
          <button type="button" className="history-scrim" tabIndex={-1} aria-label="Close the attempt history" onClick={close} />
          <div ref={dialog} className="history-dialog" role="dialog" aria-modal="true" aria-labelledby="attempt-history-title" tabIndex={-1}>
            <div className="history-head">
              <h2 id="attempt-history-title">Attempt history</h2>
              <button type="button" className="history-close" aria-label="Close the attempt history" onClick={close}><X aria-hidden="true" /></button>
            </div>
            <div className="history-panel">
              {records.length === 0 && <div className="history-empty">
                <b>No attempts recorded yet.</b>
                <span>Every time you pick the Pokémon you actually got in result entry, this keeps how many frames each press landed off target. After a few attempts it tells you whether your calibration is drifting.</span>
              </div>}
              {records.length > 0 && <ul className="history-list">{records.map((record) => <li key={record.at}>
                <div className="history-row-head">
                  <b>{record.label}</b>
                  <span>{formatAttemptTime(record.at, now)}{record.applied ? " · calibration applied" : ""}</span>
                </div>
                <div className="history-row-frames">{record.presses.map((press) => <span key={press.key} className={`history-frames practice-${attemptPressJudgment(press)}`}>
                  <small>{press.label}</small><b>{formatAttemptPress(press)}</b>
                </span>)}</div>
              </li>)}</ul>}
              {records.length > 0 && <div className="history-actions">
                <small>Keeps the last {ATTEMPT_HISTORY_LIMIT} attempts.</small>
                <button type="button" className="button button-secondary" onClick={() => { if (confirmClear) { clearAttemptHistory(tool); setConfirmClear(false); } else setConfirmClear(true); }}>{confirmClear ? "Tap again to clear" : "Clear history"}</button>
              </div>}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
