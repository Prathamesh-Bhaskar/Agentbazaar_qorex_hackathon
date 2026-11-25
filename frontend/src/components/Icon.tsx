import type { ReactElement } from 'react';

const P = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const ICONS: Record<string, ReactElement> = {
  check: <path {...P} strokeWidth="3" d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path {...P} strokeWidth="3" d="M6 6l12 12M18 6L6 18" />,
  arrow: <path {...P} strokeWidth="2" d="M5 12h14M13 6l6 6-6 6" />,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" {...P} strokeWidth="1.8" /><path {...P} strokeWidth="1.8" d="M8 10.5V7.8a4 4 0 018 0v2.7" /></>,
  info: <><circle cx="12" cy="12" r="9" {...P} strokeWidth="1.8" /><path {...P} strokeWidth="2" d="M12 11v5M12 7.5v.5" /></>,
  warn: <><path {...P} strokeWidth="1.8" d="M12 3.5l9.5 16.5h-19z" /><path {...P} strokeWidth="2" d="M12 10v4.5M12 17.2v.3" /></>,
  ext: <path {...P} strokeWidth="2" d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />,
  search: <><circle cx="11" cy="11" r="6.5" {...P} strokeWidth="1.8" /><path {...P} strokeWidth="1.8" d="M16 16l4.5 4.5" /></>,
  github: <path fill="currentColor" d="M12 2a10 10 0 00-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.9.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 015 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0012 2z" />,
  // landing page set: same 24px grid, 1.8 stroke, round caps
  shield: <path {...P} strokeWidth="1.8" d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z" />,
  shieldcheck: <><path {...P} strokeWidth="1.8" d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z" /><path {...P} strokeWidth="2" d="M8.8 12.2l2.2 2.2 4.2-4.4" /></>,
  gauge: <><path {...P} strokeWidth="1.8" d="M4.5 17a8 8 0 1115 0" /><path {...P} strokeWidth="2" d="M12 14.5l3.5-4.5" /><circle cx="12" cy="14.5" r="1.2" fill="currentColor" /></>,
  vault: <><rect x="3.5" y="5" width="17" height="14" rx="2" {...P} strokeWidth="1.8" /><circle cx="12" cy="12" r="3" {...P} strokeWidth="1.8" /><path {...P} strokeWidth="1.8" d="M12 9v1.2M12 13.8V15M9 12h1.2M13.8 12H15" /></>,
  undo: <path {...P} strokeWidth="1.9" d="M9 6l-5 5 5 5M4.5 11H15a5 5 0 010 10h-4" />,
  file: <><path {...P} strokeWidth="1.8" d="M7 3h7l4 4v13H7z" /><path {...P} strokeWidth="1.8" d="M14 3v4h4M9.5 12h5M9.5 15.5h5" /></>,
  scale: <><path {...P} strokeWidth="1.8" d="M12 4v15M7 19.5h10M4.5 7.5h15" /><path {...P} strokeWidth="1.8" d="M4.5 7.5l-2.2 6a2.4 2.4 0 004.4 0zM19.5 7.5l-2.2 6a2.4 2.4 0 004.4 0z" /></>,
  coin: <><circle cx="12" cy="12" r="8.5" {...P} strokeWidth="1.8" /><circle cx="12" cy="11.5" r="3.4" {...P} strokeWidth="1.8" /><path {...P} strokeWidth="1.8" d="M13.8 13.6l2.4 2.6" /></>,
  bot: <><rect x="5" y="8" width="14" height="11" rx="2" {...P} strokeWidth="1.8" /><path {...P} strokeWidth="1.8" d="M12 8V5M9.5 16h5" /><circle cx="12" cy="4.2" r="1" fill="currentColor" /><circle cx="9.5" cy="12.5" r="1.1" fill="currentColor" /><circle cx="14.5" cy="12.5" r="1.1" fill="currentColor" /></>,
  user: <><circle cx="12" cy="8" r="3.5" {...P} strokeWidth="1.8" /><path {...P} strokeWidth="1.8" d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>,
  network: <><circle cx="12" cy="6" r="2.2" {...P} strokeWidth="1.8" /><circle cx="6" cy="17" r="2.2" {...P} strokeWidth="1.8" /><circle cx="18" cy="17" r="2.2" {...P} strokeWidth="1.8" /><path {...P} strokeWidth="1.8" d="M11 8l-4 7M13 8l4 7M8.3 17h7.4" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" {...P} strokeWidth="1.8" /><path {...P} strokeWidth="1.8" d="M12 7.5V12l3 2" /></>,
  code: <path {...P} strokeWidth="1.9" d="M9 7l-5 5 5 5M15 7l5 5-5 5" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" {...P} strokeWidth="1.8" /><path {...P} strokeWidth="1.8" d="M5 15V6a2 2 0 012-2h9" /></>,
};

export function Icon({ name, size }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

