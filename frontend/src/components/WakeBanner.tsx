import { useIsFetching } from "@tanstack/react-query";
import { Coffee } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { Spinner } from "./ui";

/**
 * The public API runs on a free server that sleeps when nobody uses it. The first request after a
 * nap can take ~30-60 s, so instead of a page that looks broken we explain what is happening.
 */
export function WakeBanner() {
  const fetching = useIsFetching();
  const [slow, setSlow] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // Start waking the server as early as possible.
  useEffect(() => {
    api.health().catch(() => {});
  }, []);

  useEffect(() => {
    if (!fetching) {
      setSlow(false);
      setSeconds(0);
      return;
    }
    const start = Date.now();
    const t = window.setInterval(() => {
      const s = Math.round((Date.now() - start) / 1000);
      setSeconds(s);
      if (s >= 3) setSlow(true);
    }, 500);
    return () => window.clearInterval(t);
  }, [fetching]);

  if (!slow) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md animate-fade-in items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-xl sm:inset-x-auto sm:right-6"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
        <Coffee size={18} />
      </div>
      <div className="text-[13px] leading-relaxed">
        <div className="flex items-center gap-2 font-semibold">
          Waking up the server <Spinner size={14} />
        </div>
        <p className="mt-0.5 text-ink-2">
          This demo runs on free hosting that sleeps when idle. The first load can take up to a minute (
          {seconds} s so far); after that everything is instant.
        </p>
      </div>
    </div>
  );
}
