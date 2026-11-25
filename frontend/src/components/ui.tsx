import clsx from "clsx";
import { AlertTriangle, ChevronDown, Inbox, Lightbulb, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("card animate-fade-in", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div>
            {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-2">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={clsx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow mb-2 text-accent">{eyebrow}</div>}
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{title}</h1>
        {description && (
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={clsx("relative overflow-hidden rounded-lg bg-surface-2", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-ink/[0.04] to-transparent" />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted">
        {icon ?? <Inbox size={22} />}
      </div>
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] text-ink-2">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <EmptyState
      icon={<AlertTriangle size={22} className="text-bad" />}
      title="Something went wrong"
      description={message}
      action={
        onRetry && (
          <button className="btn-ghost" onClick={onRetry}>
            Try again
          </button>
        )
      }
    />
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin" />;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-lg bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-md px-2.5 py-1 text-[13px] font-medium transition",
            o.value === value ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function LegendDot({ color, dashed, label }: { color: string; dashed?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
      <svg width="16" height="8" aria-hidden>
        <line
          x1="1"
          y1="4"
          x2="15"
          y2="4"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={dashed ? "3 3" : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "good" | "bad";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "neutral" && "bg-surface-2 text-ink-2",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "good" && "bg-good/15 text-good",
        tone === "bad" && "bg-bad/15 text-bad",
      )}
    >
      {children}
    </span>
  );
}

/** Collapsible plain-language explanation shown under a chart. */
export function Explainer({
  title = "What am I looking at?",
  children,
  defaultOpen = false,
}: {
  title?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group mt-4 rounded-xl border border-line bg-surface-2/40 text-[13px] [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2.5 font-medium text-ink-2 hover:text-ink">
        <Lightbulb size={15} className="text-accent" />
        {title}
        <ChevronDown size={15} className="ml-auto transition group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-line px-4 py-3 leading-relaxed text-ink-2">{children}</div>
    </details>
  );
}

/** A jargon term with a short definition on hover / focus. */
export function Term({ children, tip }: { children: ReactNode; tip: string }) {
  return (
    <span className="group/term relative inline-block">
      <span
        tabIndex={0}
        className="cursor-help underline decoration-muted decoration-dotted underline-offset-4 outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {children}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-[12px] font-normal normal-case leading-relaxed tracking-normal text-ink-2 opacity-0 shadow-lg transition group-hover/term:opacity-100 group-focus-within/term:opacity-100"
      >
        {tip}
      </span>
    </span>
  );
}

export const TERMS = {
  mape: "Mean Absolute Percentage Error: on average, how far the forecast is from reality, in percent. Lower is better.",
  mae: "Mean Absolute Error: the average miss in megawatts, ignoring the direction.",
  rmse: "Root Mean Square Error: like MAE, but large misses count more.",
  mw: "Megawatt: a unit of power. Poland typically uses 13,000–28,000 MW at any moment.",
  gw: "Gigawatt = 1,000 megawatts.",
  gwh: "Gigawatt-hour: energy used over time. 1 GW sustained for one hour = 1 GWh.",
  pse: "Polskie Sieci Elektroenergetyczne: Poland's grid operator. It publishes the official forecast this project competes with.",
  shap: "SHAP values split a prediction into the contribution of each input, so you can see why the model predicted what it did.",
  naive: "A simple rule of thumb: assume demand will be exactly the same as at the same time one week ago.",
} as const;

export function Callout({
  icon,
  tone = "accent",
  children,
}: {
  icon?: ReactNode;
  tone?: "accent" | "good" | "neutral";
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "flex gap-3 rounded-xl border px-4 py-3 text-[13px] leading-relaxed",
        tone === "accent" && "border-accent/25 bg-accent/[0.07]",
        tone === "good" && "border-good/25 bg-good/[0.07]",
        tone === "neutral" && "border-line bg-surface-2/50",
      )}
    >
      {icon && <span className="mt-0.5 shrink-0 text-accent">{icon}</span>}
      <div className="text-ink-2">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  highlight,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={clsx(
        "card animate-fade-in p-5",
        highlight && "border-accent/40 bg-gradient-to-br from-accent/[0.09] to-transparent",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{label}</span>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <div className="tnum mt-3 text-[30px] font-semibold leading-none tracking-tight">{value}</div>
      {sub && <div className="mt-2 text-[13px] leading-snug text-ink-2">{sub}</div>}
    </div>
  );
}
