import { DEFAULT_LOADING_TEXT, POSETRACKER_LOGO_URL } from '../brand';

const SHELL_CSS = `
.pt-root {
  position: relative; width: 100%; height: 100%; min-height: 240px;
  background: #000; overflow: hidden; isolation: isolate;
}
.pt-root video, .pt-root canvas.pt-overlay {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; opacity: 0; transition: opacity 180ms ease-out;
}
.pt-root video { z-index: 1; background: #000; }
.pt-root canvas.pt-overlay { z-index: 2; pointer-events: none; }
.pt-boot {
  position: absolute; inset: 0; z-index: 4;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: #0a0a0a; color: #fff;
  font: 15px/1.4 -apple-system, system-ui, sans-serif;
  transition: opacity 180ms ease-out; gap: 0; padding: 24px; box-sizing: border-box;
}
.pt-boot.hide { opacity: 0; pointer-events: none; }
.pt-boot .pt-boot-powered {
  color: rgba(255,255,255,0.55); font-size: 11px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 10px;
}
.pt-boot .pt-boot-logo {
  width: min(220px, 62%); height: auto; margin-bottom: 22px; display: block;
  box-sizing: border-box; background: #3a3a3a; padding: 14px 16px; border-radius: 10px;
}
.pt-boot .pt-boot-spinner {
  width: 28px; height: 28px; margin-bottom: 16px;
  border: 2px solid #333; border-top-color: #ffc300; border-radius: 50%;
  animation: ptspin 0.8s linear infinite;
}
.pt-boot .pt-boot-msg {
  color: #e8e8e8; font-size: 14px; font-weight: 500;
  text-align: center; padding: 0 12px; min-height: 1.2em;
}
.pt-boot .pt-boot-msg.is-error { color: #FE8370; font-size: 13px; }
@keyframes ptspin { to { transform: rotate(360deg); } }
.pt-wm {
  position: absolute; right: 10px; bottom: 10px; z-index: 3;
  display: none; flex-direction: column; align-items: flex-end;
  pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,0.55);
}
.pt-wm.show { display: flex; }
.pt-wm .pt-wm-powered {
  color: rgba(255,255,255,0.7); font: 600 11px/1.2 -apple-system, system-ui, sans-serif;
  letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 4px;
}
.pt-wm .pt-wm-logo {
  width: 130px; height: auto; display: block; opacity: 0.92;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.45));
}
.pt-hud {
  position: absolute; left: 8px; right: 8px; bottom: 8px; z-index: 3;
  color: #fff; font: 11px/1.35 ui-monospace, monospace;
  text-shadow: 0 1px 2px #000; pointer-events: none; display: none;
}
.pt-hud.debug { display: block; }
.pt-placement {
  position: absolute; z-index: 2; pointer-events: none; display: none;
  border: 2px dashed rgba(255, 195, 0, 0.85);
  box-sizing: border-box;
  border-radius: 4px;
}
.pt-placement.show { display: block; }
`;

let styleInjected = false;

function ensureStyles(): void {
  if (styleInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.setAttribute('data-posetracker', 'shell');
  el.textContent = SHELL_CSS;
  document.head.appendChild(el);
  styleInjected = true;
}

export interface DomShell {
  root: HTMLElement;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  boot: HTMLElement;
  bootMsg: HTMLElement;
  watermark: HTMLElement;
  hud: HTMLElement;
  placement: HTMLElement;
  setBootMessage(text: string, isError?: boolean): void;
  setCameraVisible(visible: boolean): void;
  setWatermarkVisible(visible: boolean): void;
  setHud(text: string, debug: boolean): void;
  setPlacementVisible(visible: boolean, paddingPercent?: number): void;
  applyMirror(facingMode: 'user' | 'environment'): void;
  destroy(): void;
}

export function mountDomShell(
  host: HTMLElement,
  options: { loadingText?: string; logoUrl?: string } = {},
): DomShell {
  ensureStyles();
  const loadingText = (options.loadingText && options.loadingText.trim()) || DEFAULT_LOADING_TEXT;
  const logoUrl = options.logoUrl ?? POSETRACKER_LOGO_URL;

  const root = document.createElement('div');
  root.className = 'pt-root';
  root.innerHTML = `
    <video playsinline muted autoplay></video>
    <canvas class="pt-overlay"></canvas>
    <div class="pt-boot">
      <div class="pt-boot-powered">Powered by</div>
      <img class="pt-boot-logo" alt="PoseTracker" src="${logoUrl}" />
      <div class="pt-boot-spinner" aria-hidden="true"></div>
      <div class="pt-boot-msg">${loadingText}</div>
    </div>
    <div class="pt-placement" aria-hidden="true"></div>
    <div class="pt-wm">
      <div class="pt-wm-powered">Powered by</div>
      <img class="pt-wm-logo" alt="PoseTracker" src="${logoUrl}" />
    </div>
    <div class="pt-hud"></div>
  `;
  host.appendChild(root);

  const video = root.querySelector('video') as HTMLVideoElement;
  const canvas = root.querySelector('canvas.pt-overlay') as HTMLCanvasElement;
  const boot = root.querySelector('.pt-boot') as HTMLElement;
  const bootMsg = root.querySelector('.pt-boot-msg') as HTMLElement;
  const watermark = root.querySelector('.pt-wm') as HTMLElement;
  const hud = root.querySelector('.pt-hud') as HTMLElement;
  const placement = root.querySelector('.pt-placement') as HTMLElement;

  return {
    root,
    video,
    canvas,
    boot,
    bootMsg,
    watermark,
    hud,
    placement,
    setBootMessage(text, isError = false) {
      bootMsg.textContent = text;
      bootMsg.classList.toggle('is-error', isError);
    },
    setCameraVisible(visible) {
      video.style.opacity = visible ? '1' : '0';
      canvas.style.opacity = visible ? '1' : '0';
      boot.classList.toggle('hide', visible);
      if (!visible) {
        bootMsg.textContent = loadingText;
        bootMsg.classList.remove('is-error');
      }
    },
    setWatermarkVisible(visible) {
      watermark.classList.toggle('show', visible);
    },
    setHud(text, debug) {
      hud.classList.toggle('debug', debug);
      hud.textContent = text;
    },
    setPlacementVisible(visible, paddingPercent = 10) {
      placement.classList.toggle('show', visible);
      if (visible) {
        const p = Math.max(0, Math.min(40, paddingPercent));
        placement.style.left = `${p}%`;
        placement.style.top = `${p}%`;
        placement.style.right = `${p}%`;
        placement.style.bottom = `${p}%`;
      }
    },
    applyMirror(facingMode) {
      const t = facingMode === 'user' ? 'scaleX(-1)' : 'none';
      video.style.transform = t;
      canvas.style.transform = t;
    },
    destroy() {
      root.remove();
    },
  };
}
