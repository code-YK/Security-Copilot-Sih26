'use client'

/**
 * Shared dark/light theme state, persisted to localStorage.
 *
 * One provider, mounted once in the root layout, so the choice survives
 * navigation between the dashboard and a case page. The theme lives on
 * `<html data-theme>` (not a wrapper div) so every surface — including the
 * page background behind overscroll — flips together, and the tiny inline
 * script in app/layout.tsx sets that attribute before first paint so a
 * saved light theme never flashes dark first.
 */
import { createContext, useContext, useEffect, useState } from 'react'

export const THEME_STORAGE_KEY = 'scTheme'

type ThemeContextValue = { dark: boolean; toggleTheme: () => void }

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server and first client render must agree (dark), or React reports a
  // hydration mismatch on the toggle icon. The real theme is already on
  // <html> from the bootstrap script, so adopt it right after mount — and
  // only start writing back once we have, or the default would overwrite a
  // saved light theme with dark.
  const [dark, setDark] = useState(true)
  const [synced, setSynced] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.dataset.theme !== 'light')
    setSynced(true)
  }, [])

  useEffect(() => {
    if (!synced) return
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light')
    } catch {
      // Storage blocked (private mode, site data off) — the theme still applies for this visit.
    }
  }, [dark, synced])

  function toggleTheme() {
    setDark((d) => !d)
  }

  return <ThemeContext.Provider value={{ dark, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
