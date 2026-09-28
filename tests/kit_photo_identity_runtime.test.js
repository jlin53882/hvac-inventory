const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const box = { innerHTML: '' };
const elements = Object.fromEntries(
  ['k-name', 'k-note', 'k-brand', 'k-code', 'k-site'].map((id) => [id, { value: '' }]),
);
const selectedPhoto = { name: 'kit.jpg' };
elements['k-photo-input'] = { files: [selectedPhoto], addEventListener() {} };
elements['k-photo-album'] = { files: [], addEventListener() {} };
const kit = {
  id: 7,
  item_id: 42,
  name: '測試整組',
  brand: '品牌',
  code: 'K-7',
  site: 'office',
  note: '',
  has_photo: true,
  updated_at: '2026-09-28 12:00:00',
  locations: [],
  components: [],
  thumbnail_url: '/media/kit-photo/thumbnail',
};
const unrelatedItem = { id: 7, has_photo: true };
const calls = { media: [], fetch: [], openedModal: false };
const formButton = {
  textContent: '',
  setAttribute() {},
};
const title = { textContent: '' };
const overlay = { id: '', innerHTML: '', remove() {} };

/** Supply only the DOM nodes consumed by the real Kit editor/photo renderers. */
function getElementById(id) {
  if (id === 'k-photo-box') return box;
  return elements[id] || null;
}

/** Resolve modal selectors used by editKit without replacing its production logic. */
function querySelector(selector) {
  if (selector === '#kit-modal h3') return title;
  if (selector === '#kit-modal .btn-confirm') return formButton;
  return null;
}

class TestFormData {
  constructor() { this.entries = []; }
  append(name, value) { this.entries.push({ name, value }); }
}

const context = vm.createContext({
  console,
  ALL_ITEMS: [unrelatedItem, { id: 42, has_photo: true }],
  currentKitItems: [kit],
  currentSite: 'office',
  document: {
    addEventListener() {},
    getElementById,
    querySelector,
    querySelectorAll: () => [],
    createElement(tag) {
      assert.equal(tag, 'div');
      return { ...overlay };
    },
    body: { appendChild() {} },
  },
  fetch: async (url, options = {}) => {
    const request = { url, method: options.method || 'GET' };
    if (Object.hasOwn(options, 'body')) request.body = options.body;
    calls.fetch.push(request);
    if ((options.method || 'GET') === 'GET') {
      return { ok: true, json: async () => [kit] };
    }
    if (url === '/api/kits') {
      return { ok: true, json: async () => ({ id: 7, item_id: 42, name: '新整組' }) };
    }
    if (options.method === 'DELETE') {
      return { ok: true, json: async () => ({ ok: true, deleted: 7 }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  },
  FormData: TestFormData,
  setTimeout: () => 0,
  hasPerm: () => true,
  photoSrc: (itemId, size) => {
    calls.media.push({ itemId, size });
    return `/media/item-${itemId}/${size}`;
  },
  openModal: () => { calls.openedModal = true; },
  closeModalForce() {},
  toast() {},
  loadData: async () => {},
  renderKitCompRows() {},
  renderKitLocationRows() {},
  _cabinetOptions: () => '',
  globalCabinetList: [],
  kitModalCompRows: [],
  kitLocationRows: [],
});

for (const relative of [
  'static/js/modals/photo.js',
  'static/js/modals/kit.js',
  'static/js/render/kits.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), context, {
    filename: relative,
  });
}
context.renderKitCompRows = () => {};
context.renderKitLocationRows = () => {};

/** Exercise editKit and assert the real renderer uses each identity for its own contract. */
async function verifyEditAndDisplayContract() {
  await context.editKit(7);
  assert.equal(calls.openedModal, true, 'editKit should open the production modal');
  assert.deepEqual(calls.media[0], { itemId: 42, size: 'thumbnail' });
  assert.match(box.innerHTML, /openPhotoLightbox\(42\)/);
  assert.match(box.innerHTML, /deleteKitPhoto\(7,\s*42\)/);
  assert.doesNotMatch(box.innerHTML, /deleteItemPhoto\(/);

  const lightboxId = Number(box.innerHTML.match(/openPhotoLightbox\((\d+)\)/)[1]);
  context.openPhotoLightbox(lightboxId);
  assert.deepEqual(calls.media[1], { itemId: 42, size: 'preview' });
}

/** Verify the dedicated deletion flow sends Kit ID, then preserves other item UI state. */
async function verifyDeleteContract() {
  await context.deleteKitPhoto(7, 42);
  assert.deepEqual(calls.fetch.at(-1), {
    url: '/api/kits/7/photo',
    method: 'DELETE',
  });
  assert.equal(unrelatedItem.has_photo, true, 'deleting Kit media must not alter item ID 7');
  assert.equal(kit.has_photo, false, 'successful Kit photo deletion clears the Kit projection');
}

/** Confirm new-Kit mode has neither identity until create response is available. */
async function verifyCreatePreviewContract() {
  const mediaCallCount = calls.media.length;
  context.openKitModal();
  assert.match(box.innerHTML, /建立後可立即上傳照片/);
  assert.doesNotMatch(box.innerHTML, /<img\s/);
  assert.equal(calls.media.length, mediaCallCount, 'new Kit mode must not request media without an item ID');

  elements['k-name'].value = '新整組';
  elements['k-brand'].value = '品牌';
  elements['k-code'].value = 'K-7';
  context.kitModalCompRows = [{ item_id: 1, qty: 1 }];
  await context.submitKit();
  await new Promise((resolve) => setImmediate(resolve));

  const createRequest = calls.fetch.find((request) => request.url === '/api/kits' && request.method === 'POST');
  assert.ok(createRequest, 'new Kit should be created before the background photo upload');
  const upload = calls.fetch.find(
    (request) => request.url === '/api/kits/7/photo' && request.method === 'POST',
  );
  assert.ok(upload, 'create response kit.id=7 must drive the Kit photo upload route');
  assert.equal(upload.method, 'POST');
  assert.equal(upload.body.entries[0].value, selectedPhoto);
}

verifyEditAndDisplayContract()
  .then(verifyDeleteContract)
  .then(verifyCreatePreviewContract)
  .then(() => console.log('kit photo identity runtime contract passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
