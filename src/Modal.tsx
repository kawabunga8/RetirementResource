import { useEffect, useRef } from "react";

/**
 * A minimal modal dialog.
 *
 * Deliberately dependency-free: this project has no UI library and adding one
 * for four settings panels would be a poor trade. Everything a dialog owes the
 * user is here -- Escape closes it, a click on the backdrop closes it, focus
 * moves in on open and returns to the button that opened it on close, and Tab
 * cycles inside rather than escaping to the page behind.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Remember what had focus so we can hand it back on close.
    openerRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => !el.hasAttribute("disabled"));

    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modalBackdrop"
      onMouseDown={(e) => {
        // Only a click that both starts and ends on the backdrop closes it, so
        // a drag that began inside the panel does not dismiss your edits.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modalPanel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
      >
        <div className="modalHeader">
          <div>
            <h3 className="modalTitle">{title}</h3>
            {description ? <p className="modalDescription">{description}</p> : null}
          </div>
          <button
            type="button"
            className="modalClose"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="modalBody">{children}</div>

        <div className="modalFooter">
          <button type="button" className="btnSmall" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The button that opens one of the panels above.
 *
 * It carries a summary of the current setting. Hiding a control behind a button
 * is only an improvement if you can still see what it is set to -- otherwise
 * the setting has not been tidied away, it has been lost.
 */
export function SettingsButton({
  label,
  summary,
  onClick,
}: {
  label: string;
  summary: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="settingsBtn" onClick={onClick}>
      <span className="settingsBtnLabel">{label}</span>
      <span className="settingsBtnSummary">{summary}</span>
    </button>
  );
}
