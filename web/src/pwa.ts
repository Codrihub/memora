import { buildOf, isNewBuild } from './build-version';
import { $ } from './dom';
import { Modal } from './modal';
import { toast } from './toast';

export const PWA = {
  prompt: null as (Event & { prompt: () => void; userChoice: Promise<unknown> }) | null,

  init(): void {
    if ('serviceWorker' in navigator) {
      const register = (): void => {
        navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
          /* registration is best effort */
        });
      };
      if (document.readyState === 'complete') register();
      else window.addEventListener('load', register, { once: true });
    }
    watchForUpdates();
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.prompt = e as Event & { prompt: () => void; userChoice: Promise<unknown> };
      $('#pwaBtn').classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
      this.prompt = null;
      $('#pwaBtn').classList.add('hidden');
      toast('App installed', 'ok', 2600);
    });
    // iOS Safari has no beforeinstallprompt event, so show the manual button.
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
    if (ios && !standalone) $('#pwaBtn').classList.remove('hidden');
  },

  async install(): Promise<void> {
    if (this.prompt) {
      this.prompt.prompt();
      try {
        await this.prompt.userChoice;
      } catch {
        /* the user dismissed the sheet */
      }
      this.prompt = null;
      $('#pwaBtn').classList.add('hidden');
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

function runningBuild(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="memora-build"]')?.content ?? '';
}

async function serverBuild(): Promise<string> {
  try {
    const r = await fetch('/sw.js', { cache: 'no-store' });
    return r.ok ? buildOf(await r.text()) : '';
  } catch {
    return '';
  }
}

let told = false;

function reloadWhenSafe(): void {
  if (document.querySelector('.note-editor')) {
    if (!told) toast('A new version of Memora is ready. Reload when you are done editing.', 'info', 8000);
    told = true;
    return;
  }
  location.reload();
}

/** An installed app can stay open for days: on return to the foreground and every 15 minutes, load a new build when safe. */
function watchForUpdates(): void {
  const running = runningBuild();
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const d = e.data as { type?: string; version?: string } | null;
    if (d?.type !== 'NEW_VERSION') return;
    e.ports[0]?.postMessage('ok');
    // A shell from before build hashes has no meta: any announced build is newer.
    if (running ? isNewBuild(running, d.version ?? '') : true) reloadWhenSafe();
  });
  const check = async (): Promise<void> => {
    if (document.hidden || !running) return;
    if (!isNewBuild(running, await serverBuild())) return;
    void navigator.serviceWorker?.getRegistration().then((r) => r?.update());
    reloadWhenSafe();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    void check();
  });
  window.setInterval(() => void check(), 15 * 60 * 1000);
}
