const $ = (sel, root = document) => root.querySelector(sel);

/** '@handle' from an Instagram profile URL (null for post/reel URLs or anything else). */
export function instagramHandle(url) {
  const m = /instagram\.com\/([A-Za-z0-9._]+)\/?/i.exec(url || '');
  if (!m || ['p', 'reel', 'reels', 'tv', 'stories', 'explore'].includes(m[1].toLowerCase())) return null;
  return `@${m[1]}`;
}

/** Full-resolution image URL for the lightbox / grid (placeholders render from their canvas). */
export function imageSrc(work) {
  if (work.canvas) {
    work.preview ??= work.canvas.toDataURL('image/jpeg', 0.9);
    return work.preview;
  }
  return work.src;
}

/** DOM side of the experience: overlays, HUD, lightbox and grid. */
export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.manifest = { artist: 'Dan Peacock', instagram: '' };
    this.items = [];
    this.lbIndex = 0;
    this.isTouch =
      window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches);
    document.body.classList.toggle('touch', this.isTouch);

    this.el = {
      start: $('#start-screen'),
      pause: $('#pause-screen'),
      hud: $('#hud'),
      lightbox: $('#lightbox'),
      grid: $('#grid-view'),
      toast: $('#toast'),
      enter: $('#enter-btn'),
      bar: $('#loader .bar span'),
      status: $('#loader .status'),
      crosshair: $('#crosshair'),
      hover: $('#hover-label'),
      roomName: $('#room-label .room'),
      roomArtist: $('#room-label .artist'),
      help: $('#help-bar'),
    };

    this.el.enter.addEventListener('click', () => this.h.onEnter());
    $('#grid-btn').addEventListener('click', () => this.h.onOpenGrid());
    $('#resume-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.h.onResume();
    });
    $('#pause-grid-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.h.onOpenGrid();
    });
    this.el.pause.addEventListener('click', (e) => {
      if (e.target === this.el.pause) this.h.onResume();
    });
    $('#touch-menu').addEventListener('click', () => this.h.onPause());

    const lb = this.el.lightbox;
    $('.lb-close', lb).addEventListener('click', () => this.h.onCloseLightbox(false));
    $('.lb-prev', lb).addEventListener('click', () => this.showLightboxIndex(this.lbIndex - 1));
    $('.lb-next', lb).addEventListener('click', () => this.showLightboxIndex(this.lbIndex + 1));
    $('.lb-walk', lb).addEventListener('click', () => this.h.onWalkTo(this.items[this.lbIndex]));
    lb.addEventListener('click', (e) => {
      if (e.target === lb || e.target.tagName === 'FIGURE' || e.target.classList.contains('lb-image')) {
        this.h.onCloseLightbox(false);
      }
    });
    // swipe between works on touch screens
    let sx = null;
    lb.addEventListener('touchstart', (e) => (sx = e.touches[0].clientX), { passive: true });
    lb.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 60) this.showLightboxIndex(this.lbIndex + (dx < 0 ? 1 : -1));
      sx = null;
    });

    $('.grid-close', this.el.grid).addEventListener('click', () => this.h.onCloseGrid());
    document.addEventListener('keydown', (e) => this.#onKey(e));
  }

  #onKey(e) {
    if (!this.el.lightbox.classList.contains('hidden')) {
      if (e.key === 'Escape') this.h.onCloseLightbox(true);
      else if (e.key === 'ArrowLeft') this.showLightboxIndex(this.lbIndex - 1);
      else if (e.key === 'ArrowRight') this.showLightboxIndex(this.lbIndex + 1);
      return;
    }
    if (!this.el.grid.classList.contains('hidden')) {
      if (e.key === 'Escape') this.h.onCloseGrid();
      return;
    }
    if (e.code === 'KeyG') this.h.onOpenGrid();
    else if (e.code === 'KeyE' || e.code === 'Enter') this.h.onActivate?.();
  }

  setManifest(manifest, { count, placeholder }) {
    this.manifest = manifest;
    for (const n of document.querySelectorAll('.artist-name')) n.textContent = manifest.artist;
    $('#start-screen .tagline').textContent = manifest.tagline || '';
    this.el.roomArtist.textContent = manifest.artist;
    document.title = `${manifest.artist} — The Gallery House`;
    const ig = $('#start-screen .ig-link');
    if (manifest.instagram) {
      ig.href = manifest.instagram;
      ig.textContent = `${instagramHandle(manifest.instagram) || 'Instagram'} on Instagram ↗`;
      ig.classList.remove('hidden');
    }
    $('#start-screen .placeholder-note').classList.toggle('hidden', !placeholder);
    this.count = count;
  }

  setItems(items) {
    this.items = items;
    this.gridBuilt = false;
  }

  setProgress(fraction, text) {
    this.el.bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    if (text) this.el.status.textContent = text;
  }

  setReady(label = 'Enter the house') {
    this.el.enter.disabled = false;
    this.el.enter.textContent = label;
  }

  showStart(on = true) {
    this.el.start.classList.toggle('hidden', !on);
  }

  showPause(on = true) {
    this.el.pause.classList.toggle('hidden', !on);
  }

  showHUD(on = true) {
    this.el.hud.classList.toggle('hidden', !on);
    if (on && !this.helpTimer) {
      this.helpTimer = setTimeout(() => this.el.help.classList.add('faded'), 14000);
    }
  }

  setRoom(name) {
    if (name === this.roomNameValue) return;
    this.roomNameValue = name;
    const el = this.el.roomName;
    el.classList.add('changing');
    clearTimeout(this.roomTimer);
    this.roomTimer = setTimeout(() => {
      el.textContent = name;
      el.classList.remove('changing');
    }, 250);
  }

  setHover(item) {
    this.el.crosshair.classList.toggle('active', Boolean(item));
    if (item) {
      $('.title', this.el.hover).textContent = item.work.title;
      $('.hint', this.el.hover).textContent = this.isTouch ? 'Tap to view' : 'Click to view';
    }
    this.el.hover.classList.toggle('visible', Boolean(item));
  }

  openLightbox(index) {
    this.showLightboxIndex(index);
    this.el.lightbox.classList.remove('hidden');
  }

  closeLightbox() {
    this.el.lightbox.classList.add('hidden');
  }

  get lightboxOpen() {
    return !this.el.lightbox.classList.contains('hidden');
  }

  showLightboxIndex(i) {
    const n = this.items.length;
    if (!n) return;
    i = ((i % n) + n) % n;
    this.lbIndex = i;
    const item = this.items[i];
    const w = item.work;
    const lb = this.el.lightbox;
    const img = $('img', lb);
    img.src = imageSrc(w);
    img.alt = w.title;
    $('.lb-count', lb).textContent = `${i + 1} of ${n} · ${item.room?.name ?? ''}`;
    $('.lb-title', lb).textContent = w.title;
    $('.lb-meta', lb).textContent = [w.medium, w.year].filter(Boolean).join(', ');
    $('.lb-caption', lb).textContent = w.caption || '';
    const ig = $('.lb-ig', lb);
    const url = w.instagram || this.manifest.instagram;
    if (url) {
      ig.href = url;
      ig.textContent = w.instagram ? 'View on Instagram ↗' : `More on Instagram ↗`;
      ig.classList.remove('hidden');
    } else {
      ig.classList.add('hidden');
    }
    // preload neighbours
    for (const d of [1, -1]) {
      const nb = this.items[(i + d + n) % n];
      if (nb && !nb.work.canvas) new Image().src = nb.work.src;
    }
  }

  openGrid() {
    if (!this.gridBuilt) this.#buildGrid();
    this.el.grid.classList.remove('hidden');
    this.el.grid.scrollTop = 0;
  }

  closeGrid() {
    this.el.grid.classList.add('hidden');
  }

  get gridOpen() {
    return !this.el.grid.classList.contains('hidden');
  }

  #buildGrid() {
    const grid = $('.grid', this.el.grid);
    grid.textContent = '';
    this.items.forEach((item, i) => {
      const w = item.work;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'grid-item';
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = w.title;
      img.src = imageSrc(w);
      thumb.appendChild(img);
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = w.title;
      const m = document.createElement('div');
      m.className = 'm';
      m.textContent = [w.medium, w.year].filter(Boolean).join(', ') || item.room?.name || '';
      btn.append(thumb, t, m);
      btn.addEventListener('click', () => this.h.onSelectFromGrid(i));
      grid.appendChild(btn);
    });
    this.gridBuilt = true;
  }

  toast(msg, ms = 2600) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('visible'), ms);
  }
}
