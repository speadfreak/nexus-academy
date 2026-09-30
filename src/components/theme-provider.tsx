import { useAppBootstrap } from "@/components/AppBootstrap";
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
// Marks that the user made an EXPLICIT theme choice (landing toggle /
// settings). Legacy installs auto-wrote "dark" into STORAGE_KEY on every
// load, so a stored value alone can't distinguish "user chose dark" from
// "was defaulted dark". Light is the Learnyx default — only explicit
// choices (stored value + flag) are honored across reloads.
const EXPLICIT_KEY = "nexus-theme-explicit";

function hasExplicitChoice(): boolean {
  try {
    return localStorage.getItem(EXPLICIT_KEY) === "1";
  } catch {
    return false;
  }
}

function markExplicitChoice(): void {
  try {
    localStorage.setItem(EXPLICIT_KEY, "1");
  } catch {
    // ignore storage errors — choice still applies for this session
  }
}

function readStoredTheme(): Theme {
  // No explicit choice ever made → light default, always.
  if (!hasExplicitChoice()) return "light";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore storage errors
  }
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === "undefined" ? "light" : readStoredTheme(),
  );
  // Shared subscription (AppBootstrap) — do NOT subscribe per-provider.
  const { profile } = useAppBootstrap();

  // Apply the class to <html>, persist, and keep the browser UI chrome
  // (mobile address bar) in sync via the theme-color meta tag.
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
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", theme === "dark" ? "#0B0F17" : "#F7F5F0"));
  }, [theme]);

  // Sync from the saved profile preference once it loads (e.g. the user
  // picked dark in settings on another device). ONLY honored when this
  // device has an explicit theme choice — legacy profiles were auto-seeded
  // with "dark" and must not drag users who never chose away from the new
  // light default. One toggle anywhere re-enables profile roaming.
  useEffect(() => {
    if (!hasExplicitChoice()) return;
    if (profile && (profile.themePreference === "dark" || profile.themePreference === "light")) {
      setThemeState(profile.themePreference);
    }
  }, [profile?.themePreference]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = (next: Theme) => {
    markExplicitChoice();
    setThemeState(next);
  };
  const toggleTheme = () => {
    markExplicitChoice();
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  };

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
