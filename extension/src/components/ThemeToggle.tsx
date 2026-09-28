import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { getTheme, setTheme, type Theme } from "@/lib/theme";

/** A sun/moon icon button that flips the persisted light/dark theme. */
export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    void getTheme().then(setThemeState);
  }, []);

  async function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setThemeState(next);
    await setTheme(next);
  }

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      aria-label="Toggle theme"
      className="ico-btn"
    >
      {theme === "dark" ? <Moon /> : <Sun />}
    </button>
  );
}
