// For pages without app.js (sign-in, offline): translate the page's markup with the language
// file index.html-style boot loaded (window.__MEMORA_I18N__). No imports: compiled on its own.

(() => {
  const w = window as unknown as { __MEMORA_I18N__?: { lang: string; t: Record<string, string> } };
  const tb = w.__MEMORA_I18N__?.t;
  if (!tb) return;
  const run = (): void => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const n of texts) {
      if (n.parentElement?.closest('script,style,code,pre,textarea,[data-no-i18n]')) continue;
      const key = n.data.replace(/\s+/g, ' ').trim();
      const tr = key && tb[key];
      if (tr) n.data = n.data.replace(n.data.trim(), tr);
    }
    document.querySelectorAll('[aria-label],[title],[placeholder],[alt]').forEach((el) => {
      for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
        const v = el.getAttribute(a);
        const tr = v && tb[v.trim()];
        if (tr) el.setAttribute(a, tr);
      }
    });
    const title = tb[document.title];
    if (title) document.title = title;
    try {
      const code = w.__MEMORA_I18N__!.lang;
      document.documentElement.lang = code;
      if (['he', 'ar', 'ur', 'fa'].includes(code)) document.documentElement.dir = 'rtl';
    } catch {
      /* ignore */
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
