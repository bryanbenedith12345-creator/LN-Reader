/* Yolala's LN Reader - chapter image viewer with zoom and save-as. */
'use strict';

const LB = { items: [], index: 0, zoom: 1 };

function assetInfo(src) {
  const prefix = '/api/asset/';
  const at = src.indexOf(prefix);
  if (at < 0) return null;
  const rest = src.slice(at + prefix.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return { book: rest.slice(0, slash), path: decodeURIComponent(rest.slice(slash + 1)) };
}

function imageName(path) {
  const parts = String(path || '').split('/');
  return parts[parts.length - 1] || 'image';
}

function openLightbox(img) {
  const images = $$('#rBody img').filter((node) => node.getAttribute('src'));
  const at = images.indexOf(img);
  if (at < 0) return;
  LB.items = images.map((node) => {
    const src = node.getAttribute('src');
    return { src, ...(assetInfo(src) || {}) };
  });
  LB.index = at;
  LB.zoom = 1;
  showEl($('#lightbox'));
  showLightboxImage();
}

function showLightboxImage() {
  const item = LB.items[LB.index];
  if (!item) return;
  const img = $('#lbImg');
  if (img.getAttribute('src') !== item.src) img.src = item.src;
  const many = LB.items.length > 1;
  const title = chapterTitle(R.ch);
  $('#lbName').textContent = many ? title + ' · image ' + (LB.index + 1) + ' of ' + LB.items.length : title;
  $('#lbName').title = item.path || '';
  $('#lbPrev').disabled = !many;
  $('#lbNext').disabled = !many;
  applyZoom();
}

function applyZoom() {
  const img = $('#lbImg');
  img.style.transform = LB.zoom === 1 ? '' : `scale(${LB.zoom})`;
  img.style.cursor = LB.zoom === 1 ? 'default' : 'zoom-out';
  $('#lbStage').style.cursor = LB.zoom === 1 ? 'zoom-out' : 'zoom-in';
}

function stepLightbox(delta) {
  if (LB.items.length < 2) return;
  LB.index = (LB.index + delta + LB.items.length) % LB.items.length;
  LB.zoom = 1;
  showLightboxImage();
}

function closeLightbox() {
  if (!isShown($('#lightbox'))) return;
  hideEl($('#lightbox'), MOTION.base);
  LB.zoom = 1;
  setTimeout(() => { if ($('#lightbox').hidden) $('#lbImg').removeAttribute('src'); }, motionMs(MOTION.base) + 40);
}

function toggleZoom() {
  LB.zoom = LB.zoom === 1 ? 2 : 1;
  applyZoom();
}

async function saveLightboxImage() {
  const item = LB.items[LB.index];
  if (!item) return;
  if (!item.path) { toast('This image cannot be saved'); return; }
  const dot = item.path.lastIndexOf('.');
  const ext = dot > 0 ? item.path.slice(dot) : '.jpg';
  const title = R.meta ? bookTitle(R.id) : "Yolala's LN Reader";
  const name = title + ' - ' + chapterTitle(R.ch) + ' - image ' + (LB.index + 1) + ext;
  try {
    const result = await postJSON('/api/save-image', { book: item.book, path: item.path, name });
    if (result.saved) {
      const full = String(result.path);
      const cut = Math.max(full.lastIndexOf('/'), full.lastIndexOf(String.fromCharCode(92)));
      toast('Image saved · ' + full.slice(cut + 1));
    } else {
      toast('Save cancelled');
    }
  } catch (err) {
    const link = document.createElement('a');
    link.href = item.src;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast('Saving through the browser instead');
  }
}
