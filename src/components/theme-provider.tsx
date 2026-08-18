import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "nexus-theme";

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore storage errors
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === "undefined" ? "light" : readStoredTheme(),
  );
  const profile = useQuery(api.profile.getProfile);

  // Apply the class to <html> and persist.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
    root.style.colorScheme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Sync from the saved profile preference once it loads (e.g. new device).
  useEffect(() => {
    if (profile && (profile.themePreference === "dark" || profile.themePreference === "light")) {
      setThemeState(profile.themePreference);
    }
  }, [profile?.themePreference]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = (next: Theme) => setThemeState(next);
  const toggleTheme = () =>
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>.");
  }
  return context;
}
