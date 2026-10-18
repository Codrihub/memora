// Icon set for the shell and design system: 24x24 stroke icons drawn with
// currentColor. `icon(name)` returns an inline SVG string.

const P: Record<string, string> = {
  brain:
    '<path d="M9.5 4.5A2.5 2.5 0 0 0 7 7a2.6 2.6 0 0 0-2.5 3.2A3 3 0 0 0 5 15.6 2.8 2.8 0 0 0 9.5 19.5V4.5z"/><path d="M14.5 4.5A2.5 2.5 0 0 1 17 7a2.6 2.6 0 0 1 2.5 3.2 3 3 0 0 1-.5 5.4 2.8 2.8 0 0 1-4.5 3.9V4.5z"/><path d="M9.5 9H8M14.5 9H16M9.5 14H7.5M14.5 14h2"/>',
  overview:
    '<rect x="3.5" y="3.5" width="7" height="8" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="14.5" width="7" height="6" rx="2"/>',
  vault:
    '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 10.5h17"/>',
  graph:
    '<circle cx="6" cy="17" r="2.4"/><circle cx="17.5" cy="6.5" r="2.4"/><circle cx="17.5" cy="17.5" r="2.2"/><path d="M7.9 15.3 15.4 8.4M8.8 17.4h6.3"/>',
  canvas:
    '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><rect x="6.5" y="7" width="5" height="4" rx="1"/><rect x="12.5" y="12.5" width="5" height="4.5" rx="1"/><path d="M11.5 9h3a1 1 0 0 1 1 1v2.5"/>',
  tags:
    '<path d="M4 12.5V6a2 2 0 0 1 2-2h6.5L20 11.5a2 2 0 0 1 0 2.8l-5.7 5.7a2 2 0 0 1-2.8 0z"/><circle cx="8.2" cy="8.2" r="1.3"/>',
  activity: '<path d="M3 12h3.5l2.5-6 3 12 2.5-6H21"/>',
  agents:
    '<rect x="4.5" y="7.5" width="15" height="11" rx="3"/><path d="M12 3.5v4M9 12.5h.01M15 12.5h.01M9.5 15.5h5"/><path d="M2.5 12v2.5M21.5 12v2.5"/>',
  key: '<circle cx="8" cy="12" r="3.2"/><path d="M11.2 12H21M18 12v3M15 12v2.2"/>',
  tools:
    '<rect x="3" y="4.5" width="18" height="6.5" rx="3.25"/><circle cx="15.6" cy="7.75" r="1.6"/><rect x="3" y="13" width="18" height="6.5" rx="3.25"/><circle cx="8.4" cy="16.25" r="1.6"/>',
  shield: '<path d="M12 3 19 6v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/><path d="m9.2 12 2 2 3.8-4"/>',
  settings:
    '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.3-4.3"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
  'chev-left': '<path d="m14.5 6-6 6 6 6"/>',
  'chev-right': '<path d="m9.5 6 6 6-6 6"/>',
  'chev-down': '<path d="m6 9.5 6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  note: '<path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M13.5 3.5V8h4.5M8.5 13h7M8.5 16.5h5"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  'folder-plus':
    '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  help: '<circle cx="12" cy="12" r="9.2"/><path d="M9.6 9.3a2.4 2.4 0 1 1 3.3 2.2c-.8.4-1.1.9-1.1 1.7M12 16.6h.01"/>',
  download: '<path d="M12 3.5v12"/><path d="m7 10.5 5 5 5-5"/><path d="M4.5 19.5h15"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 5v6h-6"/>',
  logout: '<path d="M15 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3"/><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  pin: '<path d="M12 17v4.5M8.5 3h7l-1 6 3 3v2h-11v-2l3-3z"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z"/>',
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19.3" r=".9"/>',
  'wifi-off':
    '<path d="M3 3l18 18M8.6 16a5 5 0 0 1 6.8 0M5.5 12.5a9.5 9.5 0 0 1 4-2.3M14.6 10.3a9.5 9.5 0 0 1 3.9 2.2M2.5 9a14 14 0 0 1 4-2.6M11 5.6A14 14 0 0 1 21.5 9"/><circle cx="12" cy="19.3" r=".9"/>',
  enter: '<path d="M19.5 5v6a3 3 0 0 1-3 3h-12"/><path d="m8.5 10-4 4 4 4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
  x_circle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  sparkle: '<path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.5 10.2 12.6 4.5 10.8 10.2 9z"/><path d="M19 3.5v3M17.5 5h3"/>',
  command: '<path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H9zM15 6.5A2.5 2.5 0 1 1 17.5 9H15zM9 17.5A2.5 2.5 0 1 1 6.5 15H9zM15 17.5a2.5 2.5 0 1 0 2.5-2.5H15zM9 9h6v6H9z"/>',
};

export type IconName = keyof typeof P;

/** An icon's drawing alone (the PWA shortcut icons in scripts/icons.ts). */
export function iconPaths(name: string): string {
  return P[name] || P.note;
}

/** Inline SVG markup for an icon. `cls` defaults to the shared `.i` size. */
export function icon(name: string, cls = 'i'): string {
  const body = P[name] || P.note;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;
}
