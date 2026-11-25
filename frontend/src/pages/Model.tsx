import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, FlaskConical, Lock } from "lucide-react";

import {
  Badge,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Term,
  TERMS,
} from "../components/ui";
import { api, type ModelRun } from "../lib/api";
import { dateTime, dayLabel, featureLabel, num, pct } from "../lib/format";

function MetricTile({
  label,
  model,
  pse,
  base,
  unit,
}: {
  label: React.ReactNode;
  model: number;
  pse: number;
  base: number;
  unit: "%" | "MW";
}) {
  const f = (v: number) => (unit === "%" ? pct(v) : `${num(v)} MW`);
  return (
    <div className="rounded-xl bg-surface-2/70 p-4">
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-2 text-2xl font-semibold">{f(model)}</div>
      <div className="tnum mt-1 text-[13px] text-ink-2">
        official {f(pse)} · naive {f(base)}
      </div>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="tnum mt-1 text-[14px]">{children}</dd>
    </div>
  );
}

function CurrentModel({ run }: { run: ModelRun }) {
  const m = run.metrics;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-3xl font-semibold tracking-tight">{run.model_version}</span>
        <Badge tone="good">in production</Badge>
        {run.mlflow_run_id && <Badge tone="accent">tracked in MLflow</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-5 md:grid-cols-4">
        <Info label="Trained">{dateTime(run.trained_at)}</Info>
        <Info label="Training data">
          {dayLabel(run.train_start, false)} {run.train_start.slice(0, 4)} – {dayLabel(run.train_end, false)}{" "}
          {run.train_end.slice(0, 4)}
        </Info>
        <Info label="Held-out test">
          {dayLabel(run.test_start, false)} – {dayLabel(run.test_end, false)} {run.test_end.slice(0, 4)}
        </Info>
        <Info label="Training examples">
          {num(run.n_train)} × {String(run.params.features)} features
        </Info>
      </dl>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricTile
          label={<Term tip={TERMS.mape}>MAPE</Term>}
          model={m.model_mape}
          pse={m.pse_mape}
          base={m.baseline_mape}
          unit="%"
        />
        <MetricTile
          label={<Term tip={TERMS.mae}>MAE</Term>}
          model={m.model_mae}
          pse={m.pse_mae}
          base={m.baseline_mae}
          unit="MW"
        />
        <MetricTile
          label={<Term tip={TERMS.rmse}>RMSE</Term>}
          model={m.model_rmse}
          pse={m.pse_rmse}
          base={m.baseline_rmse}
          unit="MW"
        />
      </div>
      <details className="group rounded-xl border border-line">
        <summary className="cursor-pointer select-none px-4 py-3 text-[13px] font-medium text-ink-2 hover:text-ink">
          Model settings (LightGBM hyper-parameters)
        </summary>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line px-4 py-3 text-[13px] sm:grid-cols-3">
          {Object.entries(run.params).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-muted">{k}</dt>
              <dd className="tnum">{String(v)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

const FEATURES: [string, string[]][] = [
  [
    "Calendar",
    [
      "slot",
      "slot_sin",
      "slot_cos",
      "dow",
      "is_weekend",
      "is_holiday",
      "is_bridge",
      "is_xmas",
      "day_type",
      "month",
      "doy_sin",
      "doy_cos",
    ],
  ],
  ["Recent demand", ["lag_2d", "lag_7d", "lag_14d", "d2_mean", "d2_max", "d7_mean"]],
  ["Weather", ["temperature", "cloud_cover", "radiation", "wind_speed", "temp_day_mean", "hdd", "cdd"]],
];

const CARD_ROWS: [string, string][] = [
  ["Task", "Predict national electricity demand (MW) for each 15-minute slot of the next day."],
  ["Model type", "Gradient-boosted decision trees (LightGBM), absolute-error objective."],
  ["Intended use", "Portfolio demonstration of an end-to-end ML system; not for operational grid decisions."],
  [
    "Training data",
    "Polish national demand from PSE (net, since 14 June 2024), Open-Meteo weather, Polish holidays.",
  ],
  [
    "Evaluation",
    "Time-based split: the last 60 complete days are held out and scored against the official forecast.",
  ],
  [
    "Deployment",
    "Trained offline, tracked in MLflow, published to PostgreSQL; forecasts run daily on a schedule.",
  ],
];

const LIMITS = [
  "Forecasts are day-ahead only; the model does not update during the day.",
  "Weather inputs come from archived forecasts that are slightly fresher than what was available the morning before, so test results may be a little optimistic. The live track record has no such advantage.",
  "Rare days (holidays, extreme weather) appear only a few times in the data, so errors there are larger.",
  "One fixed test window; results would vary somewhat with a different window.",
];

export default function Model() {
  const q = useQuery({ queryKey: ["model"], queryFn: api.model });
  const current = q.data?.current;
  const mlflow = current?.mlflow_model_url ?? current?.mlflow_url ?? null;

  return (
    <>
      <PageHeader
        eyebrow="Model card"
        title="The model behind the forecasts"
        description="A model card is a short, standard summary of a machine-learning model: what it does, what data it learned from, how well it performs and where it falls short."
        actions={
          mlflow && (
            <a className="btn-ghost" href={mlflow} target="_blank" rel="noreferrer">
              <FlaskConical size={15} /> Open MLflow <ExternalLink size={13} className="text-muted" />
            </a>
          )
        }
      />

      <div className="space-y-6">
        <Callout icon={<Lock size={16} />} tone="neutral">
          <b className="text-ink">Retraining happens offline.</b> The author trains and reviews each new
          version locally (tracked in MLflow) before publishing it. The public site only serves the approved
          model, so it can't be changed by visitors.
        </Callout>

        <Card title="Deployed model" subtitle="Scores on the held-out exam period">
          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data ? (
            <Skeleton className="h-[300px]" />
          ) : current ? (
            <CurrentModel run={current} />
          ) : (
            <EmptyState title="No model deployed yet" />
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Summary">
            <dl className="divide-y divide-line text-[13px]">
              {CARD_ROWS.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[120px_1fr] gap-3 py-2.5 first:pt-0 last:pb-0">
                  <dt className="font-medium text-ink">{k}</dt>
                  <dd className="leading-relaxed text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title="Limitations" subtitle="Known weaknesses, stated up front">
            <ul className="space-y-3 text-[13px] leading-relaxed text-ink-2">
              {LIMITS.map((l) => (
                <li key={l} className="flex gap-2.5">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-muted" />
                  {l}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card
          title="Inputs (25 features)"
          subtitle="Recent-demand inputs are at least 48 hours old, so nothing from the forecast day leaks in"
        >
          <div className="grid gap-6 md:grid-cols-3">
            {FEATURES.map(([group, list]) => (
              <div key={group}>
                <div className="eyebrow mb-2">{group}</div>
                <ul className="space-y-1 text-[13px] text-ink-2">
                  {list.map((f) => (
                    <li key={f} className="flex justify-between gap-2">
                      <span>{featureLabel(f)}</span>
                      <code className="text-[11px] text-muted">{f}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        {q.data && q.data.history.length > 0 && (
          <Card title="Version history" subtitle="Most recent first" bodyClassName="p-0 pt-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line">
                    {["Version", "Trained", "Exam period", "MAPE", "Official MAPE", "MAE", "MLflow run"].map(
                      (h) => (
                        <th key={h} className="eyebrow px-5 py-2 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {q.data.history.map((r: ModelRun) => (
                    <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2/50">
                      <td className="px-5 py-3 font-medium">
                        {r.model_version} {r.is_current && <Badge tone="good">current</Badge>}
                      </td>
                      <td className="tnum px-5 py-3 text-ink-2">{dateTime(r.trained_at)}</td>
                      <td className="tnum px-5 py-3 text-ink-2">
                        {dayLabel(r.test_start, false)} – {dayLabel(r.test_end, false)}
                      </td>
                      <td className="tnum px-5 py-3 font-medium">{pct(r.metrics.model_mape)}</td>
                      <td className="tnum px-5 py-3 text-ink-2">{pct(r.metrics.pse_mape)}</td>
                      <td className="tnum px-5 py-3 text-ink-2">{num(r.metrics.model_mae)} MW</td>
                      <td className="px-5 py-3 font-mono text-[12px] text-muted">
                        {r.mlflow_run_id ? r.mlflow_run_id.slice(0, 8) : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
