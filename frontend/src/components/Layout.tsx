import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  BookOpen,
  Cpu,
  Github,
  Home,
  Linkedin,
  LineChart,
  Menu,
  Moon,
  SlidersHorizontal,
  Sun,
  Target,
  X,
  Zap,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { SITE } from "../config";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useTheme } from "../lib/theme";
import { ErrorBoundary } from "./ErrorBoundary";
import { Skeleton } from "./ui";
import { WakeBanner } from "./WakeBanner";

export const NAV = [
  { to: "/", label: "Overview", icon: Home },
  { to: "/forecast", label: "Forecast", icon: LineChart },
  { to: "/accuracy", label: "Accuracy", icon: Target },
  { to: "/what-if", label: "What-if", icon: SlidersHorizontal },
  { to: "/how-it-works", label: "How it works", icon: BookOpen },
  { to: "/model", label: "Model card", icon: Cpu },
];

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white shadow-card">
        <Zap size={17} fill="currentColor" />
      </div>
      <div className="leading-tight">
        <div className="font-semibold tracking-tight">{SITE.name}</div>
        <div className="text-[11px] text-muted">Poland's electricity demand</div>
      </div>
    </Link>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition",
              isActive ? "bg-accent/12 text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )
          }
        >
          <Icon size={17} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function DataStatus() {
  const { data } = useQuery({ queryKey: ["kpis"], queryFn: api.kpis });
  return (
    <div className="space-y-1.5 rounded-xl border border-line bg-surface-2/60 p-3 text-[12px] text-ink-2">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          {data?.rows ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-50" />
          ) : null}
          <span
            className={clsx("relative inline-flex h-2 w-2 rounded-full", data?.rows ? "bg-good" : "bg-muted")}
          />
        </span>
        {data ? `Data updated ${relativeTime(data.last_refresh)}` : "Connecting…"}
      </div>
      {data?.model_version && (
        <div className="pl-4 text-muted">Model {data.model_version} · updated daily</div>
      )}
      <div className="pl-4 text-[11px] text-muted" title={__BUILD_TIME__}>
        Site version {__BUILD_TIME__.slice(0, 16).replace("T", " ")} UTC
      </div>
    </div>
  );
}

function AuthorLinks({ className }: { className?: string }) {
  return (
    <div className={clsx("flex items-center gap-1", className)}>
      {SITE.githubUrl && (
        <a
          className="btn-ghost h-9 w-9 !px-0"
          href={SITE.githubUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Source code on GitHub"
        >
          <Github size={16} />
        </a>
      )}
      {SITE.linkedinUrl && (
        <a
          className="btn-ghost h-9 w-9 !px-0"
          href={SITE.linkedinUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="LinkedIn profile"
        >
          <Linkedin size={16} />
        </a>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
  return (
    <button onClick={toggle} className="btn-ghost h-9 w-9 !px-0" aria-label={label} title={label}>
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function Footer() {
  return (
    <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-[12px] text-muted">
      <span>
        Built by <span className="font-medium text-ink-2">{SITE.author}</span> · an end-to-end ML engineering
        project
      </span>
      <span>
        Data:{" "}
        <a className="hover:text-ink" href="https://api.raporty.pse.pl" target="_blank" rel="noreferrer">
          PSE
        </a>{" "}
        ·{" "}
        <a className="hover:text-ink" href="https://open-meteo.com" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>{" "}
        · not affiliated with PSE
      </span>
    </footer>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface lg:block">
        <div className="sticky top-0 flex h-screen flex-col px-4 py-5">
          <Brand />
          <div className="mt-8 flex-1">
            <Nav />
          </div>
          <DataStatus />
          <div className="mt-3 flex items-center justify-between px-1 text-[12px] text-muted">
            <span>by {SITE.author}</span>
            <AuthorLinks />
          </div>
        </div>
      </aside>

      <div className="relative min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/85 px-4 py-3 backdrop-blur lg:hidden">
          <Brand />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button className="btn-ghost h-9 w-9 !px-0" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu size={18} />
            </button>
          </div>
        </header>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface px-4 py-5 shadow-xl">
              <div className="flex items-center justify-between">
                <Brand />
                <button
                  className="btn-ghost h-9 w-9 !px-0"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="mt-8 flex-1">
                <Nav onNavigate={() => setOpen(false)} />
              </div>
              <DataStatus />
              <AuthorLinks className="mt-3" />
            </div>
          </div>
        )}

        <div className="absolute right-6 top-5 hidden items-center gap-1 lg:flex">
          <ThemeToggle />
        </div>
        <main key={pathname} className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-12 lg:py-10">
          <Suspense
            fallback={
              <div className="space-y-4">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-[420px] w-full" />
              </div>
            }
          >
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </Suspense>
          <Footer />
        </main>
      </div>
      <WakeBanner />
    </div>
  );
}
