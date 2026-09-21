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
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  sandbox.wprFetch = function() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    requests.push({ resolve, reject });
    return promise;
  };
  return { sandbox, bodyChildren, errors, requests };
}

/**
 * Create a report payload recognizable in gallery assertions.
 * @param {string} name - Client name marker.
 * @returns {object} Minimal production-shaped report.
 */
function report(name) {
  return {
    client_name: name,
    service_name: '保養',
    report_date: '2026-09-21',
    photos: [{ preview_url: `${name}.jpg`, download_url: `${name}.download`, original_name: `${name}.jpg` }],
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
  assert.strictEqual(h.sandbox.document.getElementById('wpr-gallery-image').src, 'latest.jpg');
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

Promise.resolve()
  .then(testStaleResponseAfterTabLeave)
  .then(testLatestGalleryWins)
  .then(testStaleErrorIsIgnored)
  .then(() => console.log('work_progress_gallery_lifecycle: 3 passed'))
  .catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
