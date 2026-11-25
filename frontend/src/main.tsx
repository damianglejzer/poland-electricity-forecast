import "@fontsource-variable/inter";
import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { Skeleton } from "./components/ui";
import { ThemeProvider } from "./lib/theme";

const Overview = lazy(() => import("./pages/Overview"));
const Forecast = lazy(() => import("./pages/Forecast"));
const Accuracy = lazy(() => import("./pages/Accuracy"));
const WhatIf = lazy(() => import("./pages/WhatIf"));
const HowItWorks = lazy(() => import("./pages/HowItWorks"));
const Model = lazy(() => import("./pages/Model"));
const NotFound = lazy(() => import("./pages/NotFound"));

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
