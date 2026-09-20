import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type Kind = "success" | "error" | "info";
interface Toast { id: number; kind: Kind; text: string }

const ToastContext = createContext<{ push: (kind: Kind, text: string) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: Kind, text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 inset-inline-end-4 z-[100] flex flex-col gap-2 w-[min(92vw,22rem)]" style={{ insetInlineEnd: "1rem" }} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="panel-elevated animate-slide-in flex items-start gap-3 px-3.5 py-3 text-sm shadow-lg">
            {t.kind === "success" && <CheckCircle2 size={16} className="text-mint mt-0.5 shrink-0" />}
            {t.kind === "error" && <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />}
            {t.kind === "info" && <Info size={16} className="text-info mt-0.5 shrink-0" />}
            <span className="flex-1 text-text-light">{t.text}</span>
            <button className="btn btn-ghost btn-sm !p-1" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
