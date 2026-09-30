// 庫存管理系統 - 工作進度：照片檢視器（含預載）

import { apiFetch } from '../../core/api-client.js';
import { createRequestGuard } from '../../core/request-guard.js';
import { appState } from '../../core/state.js';
import { toast } from '../../core/utils.js';
import { workProgressState } from './state.js';

var wprGallery = { report: null, index: 0 };
const wprGalleryGuard = createRequestGuard();
var wprGalleryPreloadState = wprCreateGalleryPreloadState();
var wprPendingGallery = { index: -1 };
/**
 * Open a full-size gallery for one pending upload without creating another object URL.
 * @param {number} index - Pending photo index.
 * @returns {void} Function result.
 */
export function wprOpenPendingGallery(index) {
  if (!workProgressState.wprSelectedFiles[index]) return;
  wprPendingGallery.index = index;
  var old = document.getElementById('wpr-pending-gallery-overlay');
  if (old) old.remove();
  var overlay = document.createElement('div');
  overlay.className = 'wpr-pending-gallery-overlay';
  overlay.id = 'wpr-pending-gallery-overlay';
  overlay.innerHTML = '<div class="wpr-pending-gallery-dialog" role="dialog" aria-modal="true" aria-labelledby="wpr-pending-gallery-title"><button type="button" class="wpr-pending-gallery-close" data-action="wpr-pending-gallery-close" aria-label="關閉待上傳照片預覽">✕</button><div id="wpr-pending-gallery-title" class="wpr-pending-gallery-count"></div><img id="wpr-pending-gallery-image" alt="待上傳照片預覽"><div id="wpr-pending-gallery-name" class="wpr-pending-gallery-name"></div><div class="wpr-pending-gallery-nav"><button type="button" data-action="wpr-pending-gallery-move" data-dir="-1">← 上一張</button><button type="button" data-action="wpr-pending-gallery-move" data-dir="1">下一張 →</button></div></div>';
  document.body.appendChild(overlay);
  wprRenderPendingGallery();
}

/**
 * Render the current pending photo using its existing preview URL.
 * @returns {void} Function result.
 */
function wprRenderPendingGallery() {
  var item = workProgressState.wprSelectedFiles[wprPendingGallery.index];
  if (!item) { wprClosePendingGallery(); return; }
  var count = document.getElementById('wpr-pending-gallery-title');
  var image = document.getElementById('wpr-pending-gallery-image');
  var name = document.getElementById('wpr-pending-gallery-name');
  if (count) count.textContent = (wprPendingGallery.index + 1) + ' / ' + workProgressState.wprSelectedFiles.length;
  if (image) image.src = item.previewUrl;
  if (name) name.textContent = item.file.name;
}

/**
 * Move through pending photos with wraparound navigation.
 * @param {number} delta - Relative gallery movement.
 * @returns {void} Function result.
 */
export function wprPendingGalleryMove(delta) {
  if (!workProgressState.wprSelectedFiles.length) return;
  wprPendingGallery.index = (wprPendingGallery.index + delta + workProgressState.wprSelectedFiles.length) % workProgressState.wprSelectedFiles.length;
  wprRenderPendingGallery();
}

/**
 * Close the pending gallery without revoking its still-live object URL.
 * @returns {void} Function result.
 */
export function wprClosePendingGallery() {
  var overlay = document.getElementById('wpr-pending-gallery-overlay');
  if (overlay) overlay.remove();
  wprPendingGallery.index = -1;
}
/**
 * Create isolated preload state for one Gallery lifecycle.
 * @returns {{completed: Object, inflight: Object}} Lifecycle-owned preload state.
 */
function wprCreateGalleryPreloadState() {
  return { completed: Object.create(null), inflight: Object.create(null) };
}

/**
 * Start one background request for a preview URL and release the Image after settlement.
 * @param {Object} photo - Gallery photo metadata.
 * @returns {void} Nothing; failures fall back to normal image navigation.
 */
function wprPreloadGalleryPhoto(photo) {
  var url = photo && photo.preview_url;
  var state = wprGalleryPreloadState;
  if (!url || state.completed[url] || state.inflight[url] || typeof Image === 'undefined') return;
  var image;
  var settled = false;
  var settle;
  try {
    image = new Image();
    state.inflight[url] = image;
    image.decoding = 'async';
    settle = function(success) {
      if (settled) return;
      settled = true;
      if (success) state.completed[url] = true;
      delete state.inflight[url];
      image.onload = null;
      image.onerror = null;
    };
    image.onload = function() { settle(true); };
    image.onerror = function() { settle(false); };
    image.src = url;
    if (typeof image.decode === 'function') {
      Promise.resolve(image.decode()).then(function() { settle(true); }, function() { settle(false); });
    }
  } catch (error) {
    if (settle) settle(false);
    else delete state.inflight[url];
  }
}

/**
 * Return preload offsets around the current photo for the initial render or move direction.
 * @param {number} [direction] - Positive for next, negative for previous, omitted initially.
 * @returns {number[]} Relative photo offsets to preload.
 */
function wprGalleryPreloadOffsets(direction) {
  if (direction > 0) return [-1, 1, 2];
  if (direction < 0) return [1, -1, -2];
  return [-1, 1];
}

/**
 * Preload bounded adjacent photos, optionally looking one extra step in the move direction.
 * @param {Object} report - Work Progress report containing photos.
 * @param {number} index - Current photo index.
 * @param {number} [direction] - Relative navigation direction.
 * @returns {void} Nothing.
 */
function wprPreloadGalleryAround(report, index, direction) {
  var photos = report && report.photos;
  if (!photos || photos.length < 2) return;
  var count = photos.length;
  var seenIndexes = Object.create(null);
  wprGalleryPreloadOffsets(direction).forEach(function(offset) {
    var targetIndex = (index + offset + count) % count;
    if (targetIndex === index || seenIndexes[targetIndex]) return;
    seenIndexes[targetIndex] = true;
    wprPreloadGalleryPhoto(photos[targetIndex]);
  });
}

/**
 * Load a report and open its preview gallery.
 * @param {number} id - Report identifier.
 * @param {number} index - Initial photo index.
 * @returns {void} Nothing; the gallery opens after the report is available.
 */
export function wprOpenGallery(id, index) {
  var token = wprGalleryGuard.next();
  wprCloseGallery(false);
  var reportPromise = workProgressState.wprLastDetailReport && workProgressState.wprLastDetailReport.id === id
    ? Promise.resolve(workProgressState.wprLastDetailReport.report)
    : apiFetch('/api/work-progress/' + id);
  reportPromise.then(function(report) {
    if (!wprGalleryGuard.isCurrent(token)) return;
    if (typeof appState.currentTab !== 'undefined' && appState.currentTab !== 'work-progress') return;
    wprGallery.report = report;
    wprGallery.index = index;
    var overlay = document.createElement('div');
    overlay.className = 'wpr-gallery-overlay';
    overlay.id = 'wpr-gallery-overlay';
    overlay.innerHTML = '<div class="wpr-gallery-dialog"><button type="button" class="wpr-gallery-close" data-action="wpr-gallery-close">✕</button><div class="wpr-gallery-count" id="wpr-gallery-count"></div><div class="wpr-gallery-stage"><img id="wpr-gallery-image" alt="施工照片"></div><div class="wpr-gallery-caption" id="wpr-gallery-caption"></div><div class="wpr-gallery-nav"><button type="button" data-action="wpr-gallery-move" data-dir="-1">← 上一張</button><a id="wpr-gallery-download" class="wpr-gallery-download">原圖下載</a><button type="button" data-action="wpr-gallery-move" data-dir="1">下一張 →</button></div></div>';
    document.body.appendChild(overlay);
    wprRenderGallery();
  }).catch(function(error) { if (!wprGalleryGuard.isCurrent(token)) return; toast(error.message, 'error'); });
}
/**
 * Render the current gallery photo and navigation controls.
 * @param {number} [direction] - Relative navigation direction for lookahead preload.
 * @returns {void} Nothing.
 */
function wprRenderGallery(direction) {
  var report = wprGallery.report, photo = report && report.photos[wprGallery.index];
  if (!photo) return;
  document.getElementById('wpr-gallery-count').textContent = (wprGallery.index + 1) + ' / ' + report.photos.length;
  var image = document.getElementById('wpr-gallery-image');
  image.decoding = 'async';
  image.src = photo.preview_url;
  document.getElementById('wpr-gallery-caption').textContent = report.client_name + ' · ' + report.service_name + ' · ' + report.report_date;
  document.getElementById('wpr-gallery-download').href = photo.download_url;
  document.getElementById('wpr-gallery-download').download = photo.original_name;
  wprPreloadGalleryAround(report, wprGallery.index, direction);
}
/**
 * Move the gallery selection with wraparound navigation.
 * @param {number} delta - Relative gallery movement.
 * @returns {void} Nothing.
 */
export function wprGalleryMove(delta) {
  if (!wprGallery.report || !wprGallery.report.photos.length) return;
  wprGallery.index = (wprGallery.index + delta + wprGallery.report.photos.length) % wprGallery.report.photos.length;
  wprRenderGallery(delta);
}
/**
 * Close the gallery overlay and release its state.
 * @param {boolean} [invalidateRequest=true] - Whether to invalidate pending gallery fetches.
 * @returns {void} Nothing.
 */
export function wprCloseGallery(invalidateRequest) {
  if (invalidateRequest !== false) wprGalleryGuard.invalidate();
  var overlay = document.getElementById('wpr-gallery-overlay');
  if (overlay) overlay.remove();
  wprGallery.report = null;
  wprGalleryPreloadState = wprCreateGalleryPreloadState();
}

// 模組載入時要執行的副作用：由頁面 entry 依原本的載入順序呼叫（issue #39）
export function initWorkProgressGallery() {
  document.addEventListener('keydown', function(event) { if (wprPendingGallery.index >= 0) { if (event.key === 'Escape') wprClosePendingGallery(); if (event.key === 'ArrowLeft') wprPendingGalleryMove(-1); if (event.key === 'ArrowRight') wprPendingGalleryMove(1); return; } if (!wprGallery.report) return; if (event.key === 'Escape') wprCloseGallery(); if (event.key === 'ArrowLeft') wprGalleryMove(-1); if (event.key === 'ArrowRight') wprGalleryMove(1); });
}
