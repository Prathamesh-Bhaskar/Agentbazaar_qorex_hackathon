'use client';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const KEY = 'agentbazaar-theme';

/** Sun/moon switch. The initial theme is set before first paint by THEME_INIT_SCRIPT (layout.tsx): saved choice, else the OS setting. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => { setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'); }, []);
  const flip = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice just will not persist */ }
    setTheme(next);
  };
  const light = theme === 'light';
  return (
    <button type="button" className="theme-toggle" onClick={flip} aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'} title={light ? 'Dark mode' : 'Light mode'}>
      {theme === null ? null : light ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.9" /><path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></svg>
      )}
    </button>
  );
}
