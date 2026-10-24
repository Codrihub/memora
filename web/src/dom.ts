// A selector that matches nothing returns a no-op stand-in, so a view still renders when its node is missing.

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

export function $(sel: string, root: ParentNode = document): HTMLElement {
  return (root.querySelector(sel) as HTMLElement | null) ?? NOOP;
}

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

export function attr(value: unknown): string {
  return esc(value);
}

const SNIP_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Keeps only the server's <b> match marks; the text between is decoded and escaped again. */
export function safeSnip(value: unknown): string {
  return String(value == null ? '' : value)
    .split(/(<\/?b>)/)
    .map((part) =>
      part === '<b>' || part === '</b>'
        ? part
        : esc(part.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => SNIP_ENTITIES[e] ?? e)),
    )
    .join('');
}

/** Add a stylesheet string to <head> once. */
export function useStyles(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const node = document.createElement('style');
  node.id = id;
  node.textContent = css;
  document.head.appendChild(node);
}
