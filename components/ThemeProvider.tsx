"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

type Theme = "light" | "dark";

interface ChartColors {
  strategy: string;
  benchmark: string;
  grid: string;
  axis: string;
  tick: string;
  tooltipBg: string;
  tooltipBorder: string;
}

interface ThemeContextType {
  theme: Theme;
  toggle: () => void;
  chartColors: ChartColors;
}

const LIGHT_CHART: ChartColors = {
  strategy: "#2563eb",
  benchmark: "#94a3b8",
  grid: "#f1f5f9",
  axis: "#e2e8f0",
  tick: "#64748b",
  tooltipBg: "#ffffff",
  tooltipBorder: "#e2e8f0",
};

const DARK_CHART: ChartColors = {
  strategy: "#60a5fa",
  benchmark: "#94a3b8",
  grid: "#1e293b",
  axis: "#475569",
  tick: "#94a3b8",
  tooltipBg: "#1e293b",
  tooltipBorder: "#475569",
};

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggle: () => {},
  chartColors: LIGHT_CHART,
});

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme, mounted]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }, []);

  const chartColors = theme === "dark" ? DARK_CHART : LIGHT_CHART;

  return (
    <ThemeContext.Provider value={{ theme, toggle, chartColors }}>
      {children}
    </ThemeContext.Provider>
  );
}
