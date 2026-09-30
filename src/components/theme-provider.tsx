import { useAppBootstrap } from "@/components/AppBootstrap";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

// The user-facing CHOICE can be "system" (follow the OS). The context's
// `theme` always carries the RESOLVED, effective theme ("dark" | "light")
// so every existing consumer comparison (Landing toggle, sonner, etc.)
// keeps working unchanged. `themeChoice` exposes the raw selection for
// the Settings appearance cards.
type Theme = "dark" | "light";
export type ThemeChoice = Theme | "system";

interface ThemeContextValue {
  /** RESOLVED effective theme — what the UI is actually showing. */
  theme: Theme;
  /** Raw user choice, including "system". */
  themeChoice: ThemeChoice;
  setTheme: (theme: ThemeChoice) => void;
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

function osPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function readStoredChoice(): ThemeChoice {
  // No explicit choice ever made → light default, always.
  if (!hasExplicitChoice()) return "light";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // ignore storage errors
  }
  return "light";
}

function resolve(choice: ThemeChoice): Theme {
  if (choice === "system") return osPrefersDark() ? "dark" : "light";
  return choice;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeChoice, setChoiceState] = useState<ThemeChoice>(() =>
    typeof window === "undefined" ? "light" : readStoredChoice(),
  );
  const [theme, setThemeState] = useState<Theme>(() => resolve(readStoredChoice()));
  // Shared subscription (AppBootstrap) — do NOT subscribe per-provider.
  const { profile } = useAppBootstrap();

  // Apply the class to <html>, persist the CHOICE, and keep the browser
  // UI chrome (mobile address bar) in sync via the theme-color meta tag.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
    root.style.colorScheme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, themeChoice);
    } catch {
      // ignore
    }
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", theme === "dark" ? "#0B0A08" : "#F7F5F0"));
  }, [theme, themeChoice]);

  // Follow the OS while the choice is "system".
  useEffect(() => {
    if (themeChoice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setThemeState(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeChoice]);

  // Sync from the saved profile preference once it loads (e.g. the user
  // picked dark in settings on another device). ONLY honored when this
  // device has an explicit theme choice AND hasn't chosen "system" locally
  // (a device-level system choice wins over a roaming dark/light flag).
  // Legacy profiles were auto-seeded with "dark" and must not drag users
  // who never chose away from the new light default. One toggle anywhere
  // re-enables profile roaming.
  useEffect(() => {
    if (!hasExplicitChoice()) return;
    if (themeChoice === "system") return;
    if (profile && (profile.themePreference === "dark" || profile.themePreference === "light")) {
      setChoiceState(profile.themePreference);
      setThemeState(profile.themePreference);
    }
  }, [profile?.themePreference]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = (next: ThemeChoice) => {
    markExplicitChoice();
    setChoiceState(next);
    setThemeState(resolve(next));
  };
  const toggleTheme = () => {
    markExplicitChoice();
    // Toggle the EFFECTIVE theme. Coming from "system", land on the
    // opposite of what the OS was showing so the click always visibly
    // flips the UI.
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <ThemeContext.Provider value={{ theme, themeChoice, setTheme, toggleTheme }}>
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
