/** Formatting helpers. Timestamps from the API carry the Europe/Warsaw offset; we read the
 * wall-clock parts straight from the string so labels don't depend on the browser's timezone. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const hhmm = (ts: string) => ts.slice(11, 16);
export const ymd = (ts: string) => ts.slice(0, 10);

export function dayLabel(date: string, withWeekday = true) {
  const [y, m, d] = date.split("-").map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${withWeekday ? WEEKDAYS[wd] + " " : ""}${d} ${MONTHS[m - 1]}`;
}

export const weekdayIndex = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export const mw = (v: number | null | undefined, digits = 0) =>
  v == null ? "–" : `${v.toLocaleString("en-US", { maximumFractionDigits: digits })} MW`;
export const gw = (v: number | null | undefined, digits = 2) =>
  v == null ? "–" : `${(v / 1000).toFixed(digits)} GW`;
export const pct = (v: number | null | undefined, digits = 2) => (v == null ? "–" : `${v.toFixed(digits)}%`);
export const num = (v: number | null | undefined, digits = 0) =>
  v == null ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: digits });

export function relativeTime(iso: string | null) {
  if (!iso) return "never";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}

export const dateTime = (iso: string | null) =>
  iso ? `${dayLabel(ymd(iso), false)} ${ymd(iso).slice(0, 4)}, ${hhmm(iso)}` : "–";

export const FEATURE_LABELS: Record<string, string> = {
  slot: "Time of day",
  slot_sin: "Time of day (sin)",
  slot_cos: "Time of day (cos)",
  dow: "Day of week",
  is_weekend: "Weekend",
  is_holiday: "Public holiday",
  is_bridge: "Bridge day",
  is_xmas: "Christmas period",
  day_type: "Day type",
  month: "Month",
  doy_sin: "Season (sin)",
  doy_cos: "Season (cos)",
  lag_2d: "Demand 2 days ago",
  lag_7d: "Demand 7 days ago",
  lag_14d: "Demand 14 days ago",
  d2_mean: "Day mean, D-2",
  d2_max: "Day peak, D-2",
  d7_mean: "Day mean, D-7",
  temperature: "Temperature",
  cloud_cover: "Cloud cover",
  radiation: "Solar radiation",
  wind_speed: "Wind speed",
  temp_day_mean: "Day mean temp.",
  hdd: "Heating degrees",
  cdd: "Cooling degrees",
};
export const featureLabel = (f: string) => FEATURE_LABELS[f] ?? f;
