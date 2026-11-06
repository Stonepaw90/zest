/* Small UI helpers: toasts, modals, busy buttons, confetti. */

const $ = (selector, root = document) => root.querySelector(selector);

export function toast(message, { kind = 'info', emoji = '', action = '', onAction = null, timeout } = {}) {
  const wrap = $('#toast-wrap');
  if (!wrap) return null;
  while (wrap.children.length >= 3) wrap.firstElementChild?.remove();

  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.innerHTML = `
    <span class="toast-emoji">${emoji || (kind === 'success' ? '✅' : kind === 'error' ? '⚠️' : '🍊')}</span>
    <span class="toast-msg"></span>`;
  node.querySelector('.toast-msg').textContent = message;

  let timer = null;
  const dismiss = () => {
    if (!node.isConnected || node.classList.contains('leaving')) return;
    clearTimeout(timer);
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  };

  if (action && onAction) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action;
    button.addEventListener('click', async () => {
      dismiss();
      try {
        await onAction();
      } catch (error) {
        toast(error.message || 'That did not work.', { kind: 'error' });
      }
    });
    node.append(button);
  }

  node.addEventListener('click', (event) => {
    if (event.target === node || event.target.classList.contains('toast-msg')) dismiss();
  });

  wrap.append(node);
  timer = setTimeout(dismiss, timeout ?? (action ? 6500 : 3800));
  return node;
}

export function setBusy(button, busy) {
  if (!button) return;
  button.classList.toggle('is-busy', busy);
  button.disabled = busy;
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const focusable = modal.querySelector('input, select, button');
    focusable?.focus({ preventScroll: true });
  }, 80);
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (modal.contains(document.activeElement)) document.activeElement.blur();
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal.is-open')) {
    document.body.style.overflow = '';
  }
}

export function closeAllModals() {
  document.querySelectorAll('.modal.is-open').forEach((modal) => {
    if (modal.contains(document.activeElement)) document.activeElement.blur();
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  });
  document.body.style.overflow = '';
}

export function confettiBurst(x = window.innerWidth / 2, y = window.innerHeight * 0.38) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = $('#confetti');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ['#f97316', '#fb923c', '#fdba74', '#fbbf24', '#16a34a', '#ffffff', '#ea580c'];
  const parts = Array.from({ length: 90 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 10;
    return {
      x,
      y,
      vx: Math.cos(angle) * speed * (0.6 + Math.random() * 0.6),
      vy: Math.sin(angle) * speed - 5,
      size: 3.5 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      life: 1,
      decay: 0.012 + Math.random() * 0.014,
      shape: Math.random() > 0.65 ? 'rect' : 'circle',
    };
  });

  const started = performance.now();
  function frame(now) {
    const elapsed = now - started;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const part of parts) {
      part.vy += 0.28;
      part.vx *= 0.992;
      part.x += part.vx;
      part.y += part.vy;
      part.rot += part.vr;
      part.life -= part.decay;
      if (part.life <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, part.life);
      ctx.translate(part.x, part.y);
      ctx.rotate(part.rot);
      ctx.fillStyle = part.color;
      if (part.shape === 'rect') {
        ctx.fillRect(-part.size / 2, -part.size / 3, part.size, part.size * 0.66);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, part.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (elapsed < 2600) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }
  requestAnimationFrame(frame);
}
