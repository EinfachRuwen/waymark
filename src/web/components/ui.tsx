import { CheckCircle2, Copy, X, AlertTriangle, Info, OctagonAlert } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { copy } from "../lib/format";

/* ───────── Button ───────── */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "dark" | "danger" | "ghost" | "default";
  size?: "sm";
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = "default", size, loading, icon, children, className = "", ...rest }: BtnProps) {
  const cls = ["btn", variant !== "default" && variant, size, !children && "icon-only", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={rest.disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ───────── Fields ───────── */

export function Field({ label, hint, error, children, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input({ label, hint, error, className = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={rest.id ?? id}>
      <input id={rest.id ?? id} className={`input ${className}`} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="text">
        <b>{label}</b>
        {description && <span>{description}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: ReactNode; badge?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}>
          {t.label}
          {t.badge !== undefined && t.badge !== null && t.badge !== 0 && <span className="badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/* ───────── Signpost: the short link as a trail sign ───────── */

export function Sign({ host, slug, size, muted }: { host?: string | null; slug: string; size?: "md" | "lg"; muted?: boolean }) {
  return (
    <span className={`sign ${size ?? ""} ${muted ? "muted-sign" : ""}`} title={host ? `${host}/${slug}` : slug}>
      {host && <span className="host">{host}/</span>}
      <span className="slug">{slug}</span>
    </span>
  );
}

/* ───────── Overlays ───────── */

function useEscape(onClose: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [onClose]);
}

function useFocusTrap(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      const first =
        el.querySelector<HTMLElement>(".drawer-body input:not([type=hidden]), .dialog-body input:not([type=hidden]), .dialog-body textarea") ||
        el.querySelector<HTMLElement>(".dialog-foot button:last-child, button");
      first?.focus();
    }
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), textarea, select, [tabindex]:not([tabindex='-1'])")];
      if (!items.length) return;
      const a = items[0];
      const b = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        b.focus();
      } else if (!e.shiftKey && document.activeElement === b) {
        e.preventDefault();
        a.focus();
      }
    };
    el?.addEventListener("keydown", on);
    return () => {
      el?.removeEventListener("keydown", on);
      prev?.focus?.();
    };
  }, [ref]);
}

export function Drawer({ title, onClose, children, footer, width }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useFocusTrap(ref);
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} ref={ref} style={width ? { width: `min(${width}px, 100vw)` } : undefined}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X className="icon" />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export function Dialog({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useFocusTrap(ref);
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className={`dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="dialog-body">
          <h2>{title}</h2>
          {children}
        </div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

/* Confirm dialog driven by a promise so call sites stay linear. */
interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  confirm?: string;
  danger?: boolean;
}
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <Dialog
          title={state.title}
          onClose={() => close(false)}
          footer={
            <>
              <Button onClick={() => close(false)}>Cancel</Button>
              <Button variant={state.danger ? "danger" : "dark"} className={state.danger ? "solid" : ""} onClick={() => close(true)} autoFocus>
                {state.confirm ?? "Confirm"}
              </Button>
            </>
          }
        >
          {state.body && <div className="muted">{state.body}</div>}
        </Dialog>
      )}
    </ConfirmCtx.Provider>
  );
}

/* ───────── Menu ───────── */

export function Menu({ trigger, children, align = "end" }: { trigger: (p: { onClick: (e: React.MouseEvent) => void; "aria-expanded": boolean }) => ReactNode; children: (close: () => void) => ReactNode; align?: "start" | "end" }) {
  const [pos, setPos] = useState<{ x: number; y: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPos(null), []);
  useEffect(() => {
    if (!pos) return;
    const on = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    setTimeout(() => addEventListener("mousedown", on));
    addEventListener("keydown", key);
    addEventListener("scroll", close, true);
    ref.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => {
      removeEventListener("mousedown", on);
      removeEventListener("keydown", key);
      removeEventListener("scroll", close, true);
    };
  }, [pos, close]);
  useLayoutEffect(() => {
    if (!pos || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    if (r.bottom > innerHeight - 8) ref.current.style.top = `${Math.max(8, pos.y - r.height - 40)}px`;
  }, [pos]);
  return (
    <>
      {trigger({
        "aria-expanded": !!pos,
        onClick: (e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos(pos ? null : { x: r.left, y: r.bottom + 4, right: innerWidth - r.right });
        },
      })}
      {pos &&
        createPortal(
          <div className="menu" role="menu" ref={ref} style={align === "end" ? { top: pos.y, right: pos.right } : { top: pos.y, left: pos.x }} onClick={(e) => e.stopPropagation()}>
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ───────── Toasts ───────── */

type Toast = { id: number; text: ReactNode; kind: "ok" | "error" };
const ToastCtx = createContext<(text: ReactNode, kind?: "ok" | "error") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: ReactNode, kind: "ok" | "error" = "ok") => {
    const id = Math.random();
    setItems((x) => [...x.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
            {t.kind === "error" ? <OctagonAlert className="icon" /> : <CheckCircle2 className="icon" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function CopyButton({ text, label = "Copy", size = "sm", iconOnly }: { text: string; label?: string; size?: "sm" | "md"; iconOnly?: boolean }) {
  const toast = useToast();
  return (
    <Button
      size={size === "md" ? undefined : size}
      variant={iconOnly ? "ghost" : "default"}
      icon={<Copy className="icon" />}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copy(text)) toast("Copied to clipboard");
      }}
    >
      {iconOnly ? null : label}
    </Button>
  );
}

/* ───────── States ───────── */

export function Empty({ sign, title, children, action }: { sign?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {sign && <Sign slug={sign} muted />}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Callout({ kind = "info", children }: { kind?: "info" | "warn" | "danger"; children: ReactNode }) {
  const I = kind === "info" ? Info : kind === "warn" ? AlertTriangle : OctagonAlert;
  return (
    <div className={`callout ${kind === "info" ? "" : kind}`}>
      <I className="icon" />
      <div>{children}</div>
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }, (_, j) => (
            <td key={j}>
              <div className="skeleton" style={{ width: `${40 + ((i * 7 + j * 13) % 50)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function ErrorNote({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="empty">
      <h3>This did not load.</h3>
      <p>{error.message}</p>
      {retry && <Button onClick={retry}>Try again</Button>}
    </div>
  );
}
