import { createContext, useCallback, useContext, useMemo, useState } from "react";

type Theme = "dark" | "light";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  // Switch the class synchronously so chart colours read from CSS vars are already updated.
  // Only an explicit toggle is remembered; otherwise the page follows the OS preference.
  const toggle = useCallback(() => {
    const next: Theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* storage unavailable */
    }
    setTheme(next);
  }, []);
  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Resolved colours for ECharts (which needs concrete colour strings, not CSS vars). */
export function useChartColors() {
  const { theme } = useTheme();
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, alpha = 1) => {
      const [r, g, b] = css.getPropertyValue(`--${name}`).trim().split(/\s+/);
      return alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
    };
    return {
      theme,
      ink: v("ink"),
      ink2: v("ink-2"),
      muted: v("muted"),
      grid: v("grid"),
      line: v("line"),
      surface: v("surface"),
      surface2: v("surface-2"),
      model: v("s-model"),
      modelSoft: v("s-model", 0.12),
      pse: v("s-pse"),
      base: v("s-base"),
      good: v("good"),
      bad: v("bad"),
      accentSoft: v("accent", 0.06),
    };
  }, [theme]);
}
export type ChartColors = ReturnType<typeof useChartColors>;
