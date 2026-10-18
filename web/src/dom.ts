// DOM helpers. Every lookup is defensive: a selector that matches nothing
// returns a no-op stand-in instead of throwing, so a view still renders when
// its node is missing from index.html.

const noopClassList = {
  add(): void {},
  remove(): void {},
  toggle(): void {},
  contains(): boolean {
    return false;
  },
};

const NOOP = new Proxy({} as HTMLElement, {
  get(_target, key) {
    if (key === 'classList') return noopClassList;
    if (key === 'style') return new Proxy({} as CSSStyleDeclaration, { get: () => '', set: () => true });
    if (key === 'dataset') return {} as DOMStringMap;
    if (key === 'querySelector' || key === 'closest') return () => NOOP;
    if (key === 'querySelectorAll') return () => [] as unknown as NodeListOf<Element>;
    if (key === 'children') return [] as unknown as HTMLCollection;
    if (key === 'offsetParent') return null;
    if (key === 'value' || key === 'textContent' || key === 'innerHTML' || key === 'title') return '';
    return undefined;
  },
  set: () => true,
});

/** First match, or the no-op stand-in when the node is absent. */
export function $(sel: string, root: ParentNode = document): HTMLElement {
  return (root.querySelector(sel) as HTMLElement | null) ?? NOOP;
}

/** Every match as an array, cast to a concrete element type. */
export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll(sel)) as unknown as T[];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

export function esc(value: unknown): string {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** Escape a value that lands in an HTML attribute position. */
export function attr(value: unknown): string {
  return esc(value);
}

/** Escape, then restore the <b> marks the server puts inside search snippets. */
export function safeSnip(value: unknown): string {
  return esc(value)
    .replace(/&lt;b&gt;/g, '<b>')
    .replace(/&lt;\/b&gt;/g, '</b>');
}

/** Add a stylesheet string to <head> once (module CSS kept in TypeScript). */
export function useStyles(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const node = document.createElement('style');
  node.id = id;
  node.textContent = css;
  document.head.appendChild(node);
}
