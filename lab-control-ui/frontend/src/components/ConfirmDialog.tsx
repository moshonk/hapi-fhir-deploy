// T041: names the concrete consequence (billable resource creation /
// destructive teardown / public exposure with the actual configured range)
// before a costly/destructive action proceeds (FR-012). The message itself
// comes verbatim from the provider's ActionDef.confirmationMessage -- this
// component never invents its own wording.

export interface ConfirmDialogProps {
  actionLabel: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ actionLabel, message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={`Confirm ${actionLabel}`}
      className="confirm-dialog"
    >
      <p className="confirm-dialog-message">{message}</p>
      <div className="confirm-dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="confirm-dialog-confirm" onClick={onConfirm}>
          Yes, {actionLabel}
        </button>
      </div>
    </div>
  );
}
