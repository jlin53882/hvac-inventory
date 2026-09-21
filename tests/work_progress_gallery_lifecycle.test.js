'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'static', 'js', 'render', 'work-progress.js');
const source = fs.readFileSync(sourcePath, 'utf8');

/**
 * Build a minimal DOM/async harness around the production gallery code.
 * @returns {{sandbox: object, bodyChildren: object[], errors: string[], requests: object[]}} Harness state.
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
      this.decoding = '';
      this.src = '';
      this.decode = function() { return Promise.resolve(); };
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
  .then(testGalleryReusesLatestDetailReport)
  .then(() => console.log('work_progress_gallery_lifecycle: 5 passed'))
  .catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
