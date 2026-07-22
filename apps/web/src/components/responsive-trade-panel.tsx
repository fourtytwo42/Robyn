"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export function ResponsiveTradePanel({
  symbol,
  side,
  onSideChange,
  dirty,
  children,
}: {
  symbol: string;
  side: "buy" | "sell";
  onSideChange: (side: "buy" | "sell") => void;
  dirty: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    setOpen(false);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, [dirty]);

  const discardAndClose = useCallback(() => {
    setConfirmDiscard(false);
    setOpen(false);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, []);

  function openFor(nextSide: "buy" | "sell", button: HTMLButtonElement) {
    openerRef.current = button;
    onSideChange(nextSide);
    setConfirmDiscard(false);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel
      .querySelector<HTMLButtonElement>(
        confirmDiscard ? ".trade-confirm-keep" : ".trade-sheet-close",
      )
      ?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmDiscard) setConfirmDiscard(false);
        else requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null);
      if (!controls.length) return;
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmDiscard, open, requestClose]);

  return (
    <>
      <div className={`trade-panel-layer ${open ? "open" : ""}`}>
        <button
          className="trade-sheet-backdrop"
          type="button"
          aria-label="Close trade sheet"
          tabIndex={open ? 0 : -1}
          onClick={requestClose}
        />
        <aside
          ref={panelRef}
          className="token-trade-panel"
          aria-labelledby="trade-panel-heading"
          aria-modal={open || undefined}
          role={open ? "dialog" : undefined}
        >
          <div className="trade-sheet-heading">
            <strong>Trade ${symbol}</strong>
            <button
              className="trade-sheet-close"
              type="button"
              onClick={requestClose}
            >
              Close
            </button>
          </div>
          {children}
          {confirmDiscard ? (
            <section
              className="trade-discard-confirm"
              role="alertdialog"
              aria-labelledby="trade-discard-heading"
            >
              <strong id="trade-discard-heading">
                Discard this entered amount?
              </strong>
              <p>Your trade has not been submitted.</p>
              <div>
                <button
                  className="trade-confirm-keep"
                  type="button"
                  onClick={() => setConfirmDiscard(false)}
                >
                  Keep editing
                </button>
                <button
                  className="trade-confirm-discard"
                  type="button"
                  onClick={discardAndClose}
                >
                  Discard and close
                </button>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
      <div className="mobile-trade-bar" aria-label={`Trade ${symbol}`}>
        {(["buy", "sell"] as const).map((value) => (
          <button
            className={`${value} ${side === value ? "active" : ""}`}
            type="button"
            onClick={(event) => openFor(value, event.currentTarget)}
            key={value}
          >
            {value === "buy" ? "Buy" : "Sell"} ${symbol}
          </button>
        ))}
      </div>
    </>
  );
}
