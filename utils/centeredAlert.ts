/**
 * Replaces the browser's native window.alert (which each browser pins to the top of the page)
 * with a dialog that is always shown in the centre of the screen. Messages queue up and are
 * shown one at a time. Not blocking, like a normal in-page modal.
 */
let installed = false;
const queue: string[] = [];
let showing = false;

const showNext = () => {
  if (showing) return;
  const message = queue.shift();
  if (message === undefined) return;
  showing = true;

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;' +
    'padding:16px;background:rgba(15,23,42,0.5);backdrop-filter:blur(2px);font-family:inherit;';

  const box = document.createElement('div');
  box.style.cssText =
    'background:#fff;color:#0f172a;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.35);' +
    'width:100%;max-width:440px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;';

  const body = document.createElement('div');
  body.style.cssText = 'padding:20px 20px 12px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:1.55;';
  body.textContent = message;

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:12px 20px 16px;display:flex;justify-content:flex-end;';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.textContent = 'ตกลง';
  ok.style.cssText =
    'background:#2563eb;color:#fff;border:0;border-radius:8px;padding:8px 24px;font-size:14px;font-weight:600;cursor:pointer;';

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    showing = false;
    showNext();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  ok.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);

  footer.appendChild(ok);
  box.appendChild(body);
  box.appendChild(footer);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  ok.focus();
};

export const installCenteredAlert = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.alert = (message?: unknown) => {
    queue.push(message === undefined ? '' : String(message));
    showNext();
  };
};
