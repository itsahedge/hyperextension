import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Description,
  Field as HField,
  Input,
  Label,
  Radio,
  RadioGroup,
} from "@headlessui/react";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "buy" | "sell";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110",
  secondary: "bg-raised text-fg hover:bg-line",
  ghost: "text-muted hover:text-fg hover:bg-raised",
  danger: "bg-down/15 text-down hover:bg-down/25",
  buy: "bg-up text-bg hover:brightness-110",
  sell: "bg-down text-bg hover:brightness-110",
};

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-[filter,background-color,color] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5",
        buttonStyles[variant],
        className,
      )}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

export function TextField({
  label,
  hint,
  error,
  suffix,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  suffix?: ReactNode;
}) {
  return (
    <HField className={cx("flex flex-col gap-1", className)}>
      <Label className="text-xs text-muted">{label}</Label>
      <div
        className={cx(
          "flex h-9 items-center rounded-md border bg-surface px-2.5 focus-within:border-accent",
          error ? "border-down" : "border-line",
        )}
      >
        <Input
          {...props}
          invalid={Boolean(error)}
          className="h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none placeholder:text-faint"
        />
        {suffix && <span className="ml-2 shrink-0 text-xs text-muted">{suffix}</span>}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-down">
          {error}
        </p>
      ) : (
        hint && <Description className="text-xs text-faint">{hint}</Description>
      )}
    </HField>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  tone,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  label: string;
  tone?: (v: T) => string;
}) {
  return (
    <RadioGroup value={value} onChange={onChange} aria-label={label} className="flex rounded-md bg-surface p-0.5">
      {options.map((o) => (
        <Radio
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          className={cx(
            "flex h-8 flex-1 cursor-pointer items-center justify-center rounded-[5px] text-xs font-medium text-muted transition-colors duration-150",
            "data-checked:bg-raised data-checked:text-fg data-disabled:cursor-not-allowed data-disabled:opacity-40",
            "data-focus:outline-2 data-focus:outline-accent",
            value === o.value && tone?.(o.value),
          )}
        >
          {o.label}
        </Radio>
      ))}
    </RadioGroup>
  );
}

export function Card({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface", className)}>
      {title && (
        <header className="flex items-center justify-between border-b border-line px-3 py-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted">{label}</span>
      <span className={cx("font-medium tabular-nums", tone)}>{value}</span>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "up" | "down" | "warn" | "accent" }) {
  const tones = {
    neutral: "bg-raised text-muted",
    up: "bg-up/15 text-up",
    down: "bg-down/15 text-down",
    warn: "bg-warn/15 text-warn",
    accent: "bg-accent/15 text-accent",
  };
  return <span className={cx("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", tones[tone])}>{children}</span>;
}

export function Notice({ tone, children }: { tone: "error" | "success" | "warn" | "info"; children: ReactNode }) {
  const tones = {
    error: "border-down/40 bg-down/10 text-down",
    success: "border-up/40 bg-up/10 text-up",
    warn: "border-warn/40 bg-warn/10 text-warn",
    info: "border-line bg-raised text-muted",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-2.5 py-2 text-xs", tones[tone])}>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-xs text-faint">{children}</p>;
}

export function Loading() {
  return (
    <div className="flex justify-center py-6 text-muted" role="status" aria-label="Loading">
      <Spinner />
    </div>
  );
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/60" aria-hidden />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full rounded-lg border border-line bg-surface p-4 shadow-xl">
          <DialogTitle className="mb-3 text-sm font-semibold">{title}</DialogTitle>
          {children}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

// Confirmation for irreversible or fund-moving actions.
export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  variant = "primary",
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  onConfirm: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title}>
      <div className="flex flex-col gap-3">
        <div className="text-xs text-muted">{children}</div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={variant} onClick={confirm} busy={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export { cx };
