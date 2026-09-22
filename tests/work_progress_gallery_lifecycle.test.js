'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'static', 'js', 'render', 'work-progress.js');
const source = fs.readFileSync(sourcePath, 'utf8');

/**
 * Build a minimal DOM/async harness around the production gallery code.
 * @returns {{sandbox: object, bodyChildren: object[], errors: string[], requests: object[], images: object[]}} Harness state.
 */
function createHarness() {
  const bodyChildren = [];
  const elements = new Map();
  const errors = [];
  const requests = [];
  const images = [];
  const document = {
    body: {
      appendChild(element) {
        bodyChildren.push(element);
        if (element.id) elements.set(element.id, element);
      },
    },
    createElement() {
      return {
        className: '',
        id: '',
        innerHTML: '',
        remove() {
          const index = bodyChildren.indexOf(this);
          if (index >= 0) bodyChildren.splice(index, 1);
          if (this.id) elements.delete(this.id);
        },
      };
    },
    getElementById(id) {
      if (elements.has(id)) return elements.get(id);
      if (id === 'wpr-gallery-overlay') return null;
      const element = { id, textContent: '', src: '', href: '', download: '', remove() { elements.delete(id); } };
      elements.set(id, element);
      return element;
    },
    addEventListener() {},
  };
  const sandbox = {
    document,
    currentTab: 'work-progress',
    wprDetailRequestTokens: {},
    toast(message) { errors.push(message); },
    esc(value) { return String(value); },
    jsStr(value) { return String(value); },
    wprFetch() {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      requests.push({ resolve, reject });
      return promise;
    },
    console,
    Promise,
    setTimeout,
    clearTimeout,
    Image: function Image() {
      let resolveDecode;
      let rejectDecode;
      this.decoding = '';
      this.src = '';
      this.onload = null;
      this.onerror = null;
      this.decode = function() {
        return new Promise((resolve, reject) => {
          resolveDecode = resolve;
          rejectDecode = reject;
        });
      };
      this.resolveDecode = function() { resolveDecode(); };
      this.rejectDecode = function() { rejectDecode(new Error('decode failed')); };
      this.completeLoad = function() { if (this.onload) this.onload(); };
      this.failLoad = function() { if (this.onerror) this.onerror(new Error('load failed')); };
      images.push(this);
    },
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  sandbox.wprFetch = function() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    requests.push({ resolve, reject });
    return promise;
  };
  return { sandbox, bodyChildren, errors, requests, images };
}

/**
 * Create a report payload recognizable in gallery assertions.
 * @param {string} name - Client name marker.
 * @returns {object} Minimal production-shaped report.
 */
function report(name, photoCount = 1) {
  const photos = Array.from({ length: photoCount }, (_, index) => ({
    preview_url: `${name}-${index}.jpg`,
    download_url: `${name}-${index}.download`,
    original_name: `${name}-${index}.jpg`,
  }));
  return {
    client_name: name,
    service_name: '保養',
    report_date: '2026-09-21',
    photos,
  };
}

/**
 * Flush the microtask queue after resolving a controlled fetch.
 * @returns {Promise<void>} Completion promise.
 */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Verify that leaving the tab invalidates a pending gallery response.
 * @returns {Promise<void>} Completion promise.
 */
async function testStaleResponseAfterTabLeave() {
  const h = createHarness();
  h.sandbox.wprOpenGallery(1, 0);
  h.sandbox.currentTab = 'calendar';
  h.sandbox.wprCloseGallery();
  h.requests[0].resolve(report('stale'));
  await flush();
  assert.strictEqual(h.bodyChildren.length, 0, 'stale response must not append a gallery');
  assert.deepStrictEqual(h.errors, [], 'stale response must not toast');
}

/**
 * Verify that the latest of two overlapping gallery requests wins.
 * @returns {Promise<void>} Completion promise.
 */
async function testLatestGalleryWins() {
  const h = createHarness();
  h.sandbox.wprOpenGallery(1, 0);
  h.sandbox.wprOpenGallery(2, 0);
  h.requests[0].resolve(report('old'));
  await flush();
  assert.strictEqual(h.bodyChildren.length, 0, 'old response must not append a gallery');
  h.requests[1].resolve(report('latest'));
  await flush();
  assert.strictEqual(h.bodyChildren.length, 1, 'latest response must append one gallery');
  assert.strictEqual(h.sandbox.document.getElementById('wpr-gallery-image').src, 'latest-0.jpg');
}

/**
 * Verify that an invalidated request does not show a stale error toast.
 * @returns {Promise<void>} Completion promise.
 */
async function testStaleErrorIsIgnored() {
  const h = createHarness();
  h.sandbox.wprOpenGallery(1, 0);
  h.sandbox.wprCloseGallery();
  h.requests[0].reject(new Error('stale'));
  await flush();
  assert.deepStrictEqual(h.errors, [], 'stale error must not toast');
}

/**
 * Verify that opening a gallery preloads only the adjacent preview URLs.
 * @returns {Promise<void>} Completion promise.
 */
async function testAdjacentPreloadAndDeduplication() {
  const h = createHarness();
  h.sandbox.wprOpenGallery(7, 1);
  h.requests[0].resolve(report('gallery', 4));
  await flush();
  assert.deepStrictEqual(h.images.map((image) => image.src).sort(), ['gallery-0.jpg', 'gallery-2.jpg']);
  h.sandbox.wprGalleryMove(1);
  assert.deepStrictEqual(h.images.map((image) => image.src).sort(), ['gallery-0.jpg', 'gallery-1.jpg', 'gallery-2.jpg', 'gallery-3.jpg']);
  h.sandbox.wprGalleryMove(-1);
  assert.strictEqual(h.images.length, 4, 'the same preview URL must not create another preloader');
}

/**
 * Verify that completed preloaders release their Image references but retain URL state.
 * @returns {Promise<void>} Completion promise.
 */
async function testCompletedPreloaderReleasesImageReference() {
  const h = createHarness();
  h.sandbox.wprPreloadGalleryPhoto({ preview_url: 'completed.jpg' });
  h.images[0].completeLoad();
  h.images[0].resolveDecode();
  await flush();
  assert.strictEqual(h.sandbox.wprGalleryPreloadState.inflight['completed.jpg'], undefined);
  assert.strictEqual(h.sandbox.wprGalleryPreloadState.completed['completed.jpg'], true);
}

/**
 * Verify that a completed preview URL does not create a second Image instance.
 * @returns {Promise<void>} Completion promise.
 */
async function testCompletedUrlIsNotPreloadedAgain() {
  const h = createHarness();
  h.sandbox.wprPreloadGalleryPhoto({ preview_url: 'cached.jpg' });
  h.images[0].completeLoad();
  await flush();
  h.sandbox.wprPreloadGalleryPhoto({ preview_url: 'cached.jpg' });
  assert.strictEqual(h.images.length, 1);
}

/**
 * Verify that a failed preload releases state and can be retried.
 * @returns {Promise<void>} Completion promise.
 */
async function testFailedPreloadCanRetry() {
  const h = createHarness();
  h.sandbox.wprPreloadGalleryPhoto({ preview_url: 'retry.jpg' });
  h.images[0].failLoad();
  await flush();
  assert.strictEqual(h.sandbox.wprGalleryPreloadState.inflight['retry.jpg'], undefined);
  assert.strictEqual(h.sandbox.wprGalleryPreloadState.completed['retry.jpg'], undefined);
  h.sandbox.wprPreloadGalleryPhoto({ preview_url: 'retry.jpg' });
  assert.strictEqual(h.images.length, 2);
}

/**
 * Verify that closing a Gallery clears completed and inflight preload state.
 * @returns {Promise<void>} Completion promise.
 */
async function testCloseClearsPreloadLifecycleState() {
  const h = createHarness();
  h.sandbox.wprPreloadGalleryPhoto({ preview_url: 'close-completed.jpg' });
  h.images[0].completeLoad();
  await flush();
  h.sandbox.wprPreloadGalleryPhoto({ preview_url: 'close-inflight.jpg' });
  h.sandbox.wprCloseGallery();
  assert.deepStrictEqual(Object.keys(h.sandbox.wprGalleryPreloadState.completed), []);
  assert.deepStrictEqual(Object.keys(h.sandbox.wprGalleryPreloadState.inflight), []);
}

/**
 * Verify that a stale preload callback cannot mutate the next Gallery lifecycle.
 * @returns {Promise<void>} Completion promise.
 */
async function testStalePreloadCompletionCannotMutateNewGalleryLifecycle() {
  const h = createHarness();
  h.sandbox.wprPreloadGalleryPhoto({ preview_url: 'race.jpg' });
  const imageA = h.images[0];
  h.sandbox.wprCloseGallery();
  h.sandbox.wprPreloadGalleryPhoto({ preview_url: 'race.jpg' });
  const imageB = h.images[1];
  const stateB = h.sandbox.wprGalleryPreloadState;
  assert.strictEqual(stateB.inflight['race.jpg'], imageB);
  imageA.completeLoad();
  await flush();
  assert.strictEqual(stateB.completed['race.jpg'], undefined);
  assert.strictEqual(stateB.inflight['race.jpg'], imageB);
  imageB.completeLoad();
  await flush();
  assert.strictEqual(stateB.completed['race.jpg'], true);
  assert.strictEqual(stateB.inflight['race.jpg'], undefined);
}

/**
 * Verify that forward movement adds one directional lookahead without eager loading all photos.
 * @returns {Promise<void>} Completion promise.
 */
async function testForwardNavigationLookahead() {
  const h = createHarness();
  h.sandbox.wprOpenGallery(9, 2);
  h.requests[0].resolve(report('forward', 6));
  await flush();
  h.sandbox.wprGalleryMove(1);
  const urls = h.images.map((image) => image.src);
  assert.ok(urls.includes('forward-3.jpg'));
  assert.ok(urls.includes('forward-4.jpg'));
  assert.ok(urls.includes('forward-5.jpg'));
  assert.ok(h.images.length < 6, 'directional lookahead must remain bounded');
}

/**
 * Verify that backward movement adds one directional lookbehind without eager loading all photos.
 * @returns {Promise<void>} Completion promise.
 */
async function testBackwardNavigationLookahead() {
  const h = createHarness();
  h.sandbox.wprOpenGallery(10, 3);
  h.requests[0].resolve(report('backward', 6));
  await flush();
  h.sandbox.wprGalleryMove(-1);
  const urls = h.images.map((image) => image.src);
  assert.ok(urls.includes('backward-2.jpg'));
  assert.ok(urls.includes('backward-1.jpg'));
  assert.ok(urls.includes('backward-0.jpg'));
  assert.ok(h.images.length < 6, 'directional lookahead must remain bounded');
}

/**
 * Verify forward and backward lookahead wrap around the photo list.
 * @returns {Promise<void>} Completion promise.
 */
async function testDirectionalLookaheadWraparound() {
  const forward = createHarness();
  forward.sandbox.wprOpenGallery(11, 3);
  forward.requests[0].resolve(report('wrap-forward', 4));
  await flush();
  forward.sandbox.wprGalleryMove(1);
  assert.ok(forward.images.map((image) => image.src).includes('wrap-forward-1.jpg'));
  assert.ok(forward.images.map((image) => image.src).includes('wrap-forward-2.jpg'));

  const backward = createHarness();
  backward.sandbox.wprOpenGallery(12, 0);
  backward.requests[0].resolve(report('wrap-backward', 4));
  await flush();
  backward.sandbox.wprGalleryMove(-1);
  assert.ok(backward.images.map((image) => image.src).includes('wrap-backward-2.jpg'));
  assert.ok(backward.images.map((image) => image.src).includes('wrap-backward-1.jpg'));
}

/**
 * Verify repeated movement reuses inflight URLs instead of creating duplicate Images.
 * @returns {Promise<void>} Completion promise.
 */
async function testRapidNavigationDeduplicatesPreloadImages() {
  const forward = createHarness();
  forward.sandbox.wprOpenGallery(13, 1);
  forward.requests[0].resolve(report('rapid-forward', 8));
  await flush();
  forward.sandbox.wprGalleryMove(1);
  forward.sandbox.wprGalleryMove(1);
  forward.sandbox.wprGalleryMove(1);
  const forwardUrls = forward.images.map((image) => image.src);
  assert.strictEqual(new Set(forwardUrls).size, forwardUrls.length);

  const backward = createHarness();
  backward.sandbox.wprOpenGallery(14, 6);
  backward.requests[0].resolve(report('rapid-backward', 8));
  await flush();
  backward.sandbox.wprGalleryMove(-1);
  backward.sandbox.wprGalleryMove(-1);
  backward.sandbox.wprGalleryMove(-1);
  const backwardUrls = backward.images.map((image) => image.src);
  assert.strictEqual(new Set(backwardUrls).size, backwardUrls.length);
}

/**
 * Verify that a report already loaded for its detail view is reused by the gallery.
 * @returns {Promise<void>} Completion promise.
 */
async function testGalleryReusesLatestDetailReport() {
  const h = createHarness();
  h.sandbox.wprOpenHistoryDetail(8);
  h.requests[0].resolve(report('cached', 2));
  await flush();
  h.sandbox.wprOpenGallery(8, 0);
  await flush();
  assert.strictEqual(h.requests.length, 1, 'gallery should reuse the latest detail response');
  assert.strictEqual(h.bodyChildren.length, 1);
}

Promise.resolve()
  .then(testStaleResponseAfterTabLeave)
  .then(testLatestGalleryWins)
  .then(testStaleErrorIsIgnored)
  .then(testAdjacentPreloadAndDeduplication)
  .then(testCompletedPreloaderReleasesImageReference)
  .then(testCompletedUrlIsNotPreloadedAgain)
  .then(testFailedPreloadCanRetry)
  .then(testCloseClearsPreloadLifecycleState)
  .then(testStalePreloadCompletionCannotMutateNewGalleryLifecycle)
  .then(testForwardNavigationLookahead)
  .then(testBackwardNavigationLookahead)
  .then(testDirectionalLookaheadWraparound)
  .then(testRapidNavigationDeduplicatesPreloadImages)
  .then(testGalleryReusesLatestDetailReport)
  .then(() => console.log('work_progress_gallery_lifecycle: 14 passed'))
  .catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
