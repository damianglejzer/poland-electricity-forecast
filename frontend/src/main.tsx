import "@fontsource-variable/inter";
import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ComponentType, StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { Skeleton } from "./components/ui";
import { ThemeProvider } from "./lib/theme";

/**
 * Pages are separate files whose names change with every build. A tab opened before a new
 * deployment may ask for a file that no longer exists; reload once to pick up the new version.
 */
const RELOAD_KEY = "reloaded-for-new-version";
function page(load: () => Promise<{ default: ComponentType }>) {
  return lazy(() =>
    load()
      .then((m) => {
        sessionStorage.removeItem(RELOAD_KEY);
        return m;
      })
      .catch((err) => {
        if (!sessionStorage.getItem(RELOAD_KEY)) {
          sessionStorage.setItem(RELOAD_KEY, "1");
          window.location.reload();
          return new Promise<never>(() => {}); // wait for the reload
        }
        throw err;
      }),
  );
}

const Overview = page(() => import("./pages/Overview"));
const Forecast = page(() => import("./pages/Forecast"));
const Accuracy = page(() => import("./pages/Accuracy"));
const WhatIf = page(() => import("./pages/WhatIf"));
const HowItWorks = page(() => import("./pages/HowItWorks"));
const Model = page(() => import("./pages/Model"));
const NotFound = page(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  // Retries cover the free API server waking up from sleep.
  defaultOptions: { queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 2 } },
});

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-[420px] w-full" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Overview />} />
                <Route path="forecast" element={<Forecast />} />
                <Route path="accuracy" element={<Accuracy />} />
                <Route path="what-if" element={<WhatIf />} />
                <Route path="how-it-works" element={<HowItWorks />} />
                <Route path="model" element={<Model />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
