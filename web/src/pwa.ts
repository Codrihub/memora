// Progressive web app bits: service worker registration and install prompt.

import { $ } from './dom';
import { Modal } from './modal';
import { toast } from './toast';

export const PWA = {
  prompt: null as (Event & { prompt: () => void; userChoice: Promise<unknown> }) | null,

  init(): void {
    if ('serviceWorker' in navigator) {
      const register = (): void => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
          /* registration is best effort */
        });
      };
      // init runs after boot, usually well after the load event has fired.
      if (document.readyState === 'complete') register();
      else window.addEventListener('load', register, { once: true });
    }
    watchForUpdates();
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.prompt = e as Event & { prompt: () => void; userChoice: Promise<unknown> };
      const b = $('#pwaBtn');
      if (b.classList) b.classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
      this.prompt = null;
      const b = $('#pwaBtn');
      if (b.classList) b.classList.add('hidden');
      toast('App installed', 'ok', 2600);
    });
    // iOS Safari has no beforeinstallprompt event, so show the manual button.
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
    if (ios && !standalone) {
      const b = $('#pwaBtn');
      if (b.classList) b.classList.remove('hidden');
    }
  },

  async install(): Promise<void> {
    const b = $('#pwaBtn');
    if (this.prompt) {
      this.prompt.prompt();
      try {
        await this.prompt.userChoice;
      } catch {
        /* the user dismissed the sheet */
      }
      this.prompt = null;
      if (b.classList) b.classList.add('hidden');
      return;
    }
    Modal.open({
      title: 'Install Memora',
      body: `<div class="panel-body" style="padding:0">
        <p><b>Desktop (Chrome or Edge)</b> - click the install icon at the right end of the address bar, or open the <span class="mono">&#8942;</span> menu and choose <i>Install</i>.</p>
        <p><b>Android (Chrome)</b> - open the <span class="mono">&#8942;</span> menu and choose <i>Add to home screen</i>.</p>
        <p><b>iPhone or iPad (Safari)</b> - tap <i>Share</i> and choose <i>Add to Home Screen</i>.</p>
        <p style="color:var(--muted)">Once installed, the app has its own icon, opens full screen and stays reachable when the network drops.</p></div>`,
      actions: [{ label: 'Got it', cls: 'primary', run: () => Modal.close() }],
    });
  },
};

/** The running app.js, by its ETag (the server's content hash). */
async function appTag(): Promise<string> {
  try {
    const r = await fetch('/app.js', { method: 'HEAD', cache: 'no-store' });
    return r.ok ? r.headers.get('etag') || '' : '';
  } catch {
    return '';
  }
}

let told = false;

/** Load the new version now, unless a node is open in the editor. */
function reloadWhenSafe(): void {
  if (document.querySelector('.note-editor')) {
    if (!told) toast('A new version of Memora is ready. Reload when you are done editing.', 'info', 8000);
    told = true;
    return;
  }
  location.reload();
}

/**
 * An installed app can stay open for days. When it comes back to the
 * foreground (and every 15 minutes while in view), check whether a new
 * version was deployed and load it when safe.
 */
function watchForUpdates(): void {
  let boot = '';
  // The service worker announces a new version as soon as it takes over.
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const d = e.data as { type?: string } | null;
    if (d?.type !== 'NEW_VERSION') return;
    e.ports[0]?.postMessage('ok');
    reloadWhenSafe();
  });
  void appTag().then((t) => (boot = t));
  const check = async (): Promise<void> => {
    if (document.hidden) return;
    const now = await appTag();
    // The first successful read is the running version (boot may have been offline).
    if (!boot) {
      boot = now;
      return;
    }
    if (!now || now === boot) return;
    void navigator.serviceWorker?.getRegistration().then((r) => r?.update());
    reloadWhenSafe();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    void navigator.serviceWorker?.getRegistration().then((r) => r?.update());
    void check();
  });
  window.setInterval(() => void check(), 15 * 60 * 1000);
}
