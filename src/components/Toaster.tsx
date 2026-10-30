import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

export interface ToastInput {
  tone: "success" | "warn" | "error";
  title: string;
  body?: ReactNode;
}

interface Toast extends ToastInput {
  id: number;
}

// Failures stay longer: they usually need reading or action.
const DURATION_MS = { success: 5_000, warn: 9_000, error: 12_000 } as const;
const MAX_VISIBLE = 3;

const ToastContext = createContext<(toast: ToastInput) => void>(() => {});

export const useToast = () => useContext(ToastContext);

// Toasts float just under the header, so a result is visible however far the
// screen is scrolled, and they never shift the layout.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((all) => [...all, { ...toast, id }].slice(-MAX_VISIBLE));
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 top-13 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONES = {
  success: { border: "border-up/50", title: "text-up" },
  warn: { border: "border-warn/50", title: "text-warn" },
  error: { border: "border-down/50", title: "text-down" },
} as const;

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), DURATION_MS[toast.tone]);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);

  const tone = TONES[toast.tone];
  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className={cx(
        "pointer-events-auto flex items-start gap-2 rounded-md border bg-raised px-3 py-2 text-xs shadow-lg motion-safe:animate-[toast-in_160ms_ease-out]",
        tone.border,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cx("font-medium", tone.title)}>{toast.title}</p>
        {toast.body && <p className="mt-0.5 break-words text-muted">{toast.body}</p>}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
        className="-mr-1 -mt-0.5 rounded p-1 text-faint hover:bg-line hover:text-fg"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
