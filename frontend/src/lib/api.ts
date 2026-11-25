export type SeriesPoint = {
  ts: string;
  actual: number | null;
  pse: number | null;
  model: number | null;
  baseline: number | null;
};
export type DayInfo = {
  date: string;
  model_kind: "forecast" | "backtest" | "insample" | null;
  day_type: string;
  holiday: string | null;
};
export type Series = { start: string; end: string; days: DayInfo[]; points: SeriesPoint[] };

export type Kpis = {
  today: string;
  tomorrow: string;
  last_refresh: string | null;
  actuals_until: string | null;
  rows: number;
  first_day: string | null;
  last_day: string | null;
  model_version: string | null;
  latest_forecast_day: string | null;
  /** Day the headline forecast refers to: tomorrow, or the latest forecast day if newer data is missing. */
  forecast_day: string;
  tomorrow_peak: {
    value: number;
    ts: string;
    pse_value?: number;
    pse_ts?: string;
    energy_gwh: number;
  } | null;
  accuracy_30d: { model: number; pse: number; baseline: number; days: number } | null;
};

export type SourceKey = "model" | "pse" | "baseline";
export type MetricSet = { mape: number; mae: number; rmse: number };
export type Benchmark =
  | { available: false }
  | {
      available: true;
      start: string;
      end: string;
      n_days: number;
      summary: Record<SourceKey, MetricSet>;
      daily: ({ business_date: string } & Record<SourceKey, number>)[];
      by_hour: ({ hour: number } & Record<SourceKey, number>)[];
      by_day_type: ({ day_type: string; n_days: number } & Record<SourceKey, number>)[];
    };

export type TrackRecord = Benchmark & { first_forecast?: string };

export type Insights =
  | { available: false }
  | {
      available: true;
      profile: { time: string; weekday?: number; saturday?: number; sunday?: number }[];
      temperature: { date: string; temperature: number; demand: number; day_type: string }[];
      coverage: { first_day: string; last_day: string; rows: number };
    };

export type ModelRun = {
  id: number;
  model_version: string;
  mlflow_run_id: string | null;
  trained_at: string;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  n_train: number;
  params: Record<string, number | string>;
  metrics: Record<string, number>;
  is_current: boolean;
  mlflow_url: string | null;
  mlflow_model_url?: string;
};

export type ModelInfo = { current: ModelRun | null; history: ModelRun[] };

export type Importance = {
  model_version: string;
  features: { feature: string; group: string; gain: number; mean_abs_shap: number }[];
  groups: Record<string, number>;
};

export type WhatIfRequest = {
  date?: string;
  temp_delta: number;
  cloud_cover: number | null;
  holiday: boolean | null;
  dow: number | null;
};
export type WhatIf = {
  date: string;
  model_version: string;
  inputs: {
    temperature_mean: number;
    cloud_cover_mean: number;
    is_holiday: boolean;
    holiday_name: string | null;
    dow: number;
  };
  points: { ts: string; base: number; scenario: number }[];
  summary: {
    base_peak: number;
    base_peak_ts: string;
    scenario_peak: number;
    scenario_peak_ts: string;
    base_energy_gwh: number;
    scenario_energy_gwh: number;
    expected_value: number;
  };
  contributions: { feature: string; group: string; base: number; scenario: number; delta: number }[];
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Base URL of the API. Empty in local Docker (nginx proxies /api); the Render URL on Vercel. */
export const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  series: (start: string, days = 2) => request<Series>(`/series?start=${start}&days=${days}`),
  kpis: () => request<Kpis>("/kpis"),
  benchmark: (days?: number) => request<Benchmark>(`/benchmark${days ? `?days=${days}` : ""}`),
  model: () => request<ModelInfo>("/model"),
  importance: () => request<Importance>("/model/importance"),
  trackRecord: () => request<TrackRecord>("/track-record"),
  insights: () => request<Insights>("/insights"),
  health: () => request<{ status: string }>("/health"),
  whatif: (body: WhatIfRequest) => request<WhatIf>("/whatif", { method: "POST", body: JSON.stringify(body) }),
};
