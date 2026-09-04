import type { ReactNode } from 'react';

type IconName =
  | 'new' | 'open' | 'save' | 'download' | 'undo' | 'redo' | 'layout'
  | 'start' | 'process' | 'decision' | 'end' | 'trash' | 'note' | 'image' | 'more';

const PATHS: Record<IconName, ReactNode> = {
  new: <><path d="M12 5v14M5 12h14"/><path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/></>,
  open: <><path d="M3 6.5h6l2 2h10v10.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="m3 11 3-5h3"/></>,
  save: <><path d="M5 3h12l3 3v15H4V4a1 1 0 0 1 1-1Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 20h14"/></>,
  undo: <><path d="m9 7-5 5 5 5"/><path d="M20 17a7 7 0 0 0-7-7H4"/></>,
  redo: <><path d="m15 7 5 5-5 5"/><path d="M4 17a7 7 0 0 1 7-7h9"/></>,
  layout: <><rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="4" width="6" height="5" rx="1"/><rect x="9" y="15" width="6" height="5" rx="1"/><path d="M6 9v3h12V9M12 12v3"/></>,
  start: <circle cx="12" cy="12" r="8"/>,
  process: <rect x="4" y="6" width="16" height="12" rx="2"/>,
  decision: <path d="m12 3 9 9-9 9-9-9Z"/>,
  end: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/></>,
  trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7"/><path d="M10 11v6m4-6v6"/></>,
  note: <><path d="M5 3h14v18H5Z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 3 3 2-2 6 5"/></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
