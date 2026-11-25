/* Yolala's LN Reader - showing and dismissing overlays in one place.
   Everything that appears animates in and, just as importantly, eases out
   again instead of blinking away. The timings match the --dur-* tokens in
   base.css, and the whole layer steps aside for reduced-motion readers. */
'use strict';

const MOTION_REDUCED = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOTION = { fast: 130, base: 180, drawer: 280 };
const closeTimers = new WeakMap();

function motionMs(ms) {
  return MOTION_REDUCED ? 0 : ms;
}

function isShown(node) {
  return !!node && !node.hidden && !node.classList.contains('is-closing');
}

function showEl(node) {
  if (!node) return;
  const pending = closeTimers.get(node);
  if (pending) { clearTimeout(pending); closeTimers.delete(node); }
  node.classList.remove('is-closing');
  node.hidden = false;
}

function hideEl(node, ms = MOTION.fast) {
  if (!isShown(node)) return;
  const wait = motionMs(ms);
  if (!wait) { node.hidden = true; return; }
  node.classList.add('is-closing');
  const pending = closeTimers.get(node);
  if (pending) clearTimeout(pending);
  closeTimers.set(node, setTimeout(() => {
    closeTimers.delete(node);
    node.classList.remove('is-closing');
    node.hidden = true;
  }, wait));
}
