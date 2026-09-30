const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installApiClient, loadModules, mockResponse } = require('./support/frontend-runtime');

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
  if (id === 'kit-submit') return formButton;
  return elements[id] || null;
}

/** Resolve modal selectors used by editKit without replacing its production logic. */
function querySelector(selector) {
  if (selector === '#kit-modal h3') return title;
  return null;
}

class TestFormData {
  constructor() { this.entries = []; }
  append(name, value) { this.entries.push({ name, value }); }
}

const context = vm.createContext({
  console,
  appState: { ALL_ITEMS: [unrelatedItem, { id: 42, has_photo: true }], currentKitItems: [kit], currentSite: 'office', globalCabinetList: [] },
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
      return mockResponse([kit]);
    }
    if (url === '/api/kits') {
      return mockResponse(({ id: 7, item_id: 42, name: '新整組' }));
    }
    if (options.method === 'DELETE') {
      return mockResponse(({ ok: true, deleted: 7 }));
    }
    return mockResponse(({ ok: true }));
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
});

installApiClient(context);
loadModules(context, 'features/inventory/photo.js', 'features/kits/state.js', 'features/kits/kit-modal.js', 'features/kits/page.js');
context.renderKitCompRows = () => {};
context.renderKitLocationRows = () => {};

/** Exercise editKit and assert the real renderer uses each identity for its own contract. */
async function verifyEditAndDisplayContract() {
  await context.editKit(7);
  assert.equal(calls.openedModal, true, 'editKit should open the production modal');
  assert.deepEqual(calls.media[0], { itemId: 42, size: 'thumbnail' });
  assert.match(box.innerHTML, /data-action="photo-lightbox" data-id="42"/);
  assert.match(box.innerHTML, /data-action="inventory-kit-photo-delete" data-kit-id="7" data-id="42"/);
  assert.doesNotMatch(box.innerHTML, /deleteItemPhoto\(/);

  const lightboxId = Number(box.innerHTML.match(/data-action="photo-lightbox" data-id="(\d+)"/)[1]);
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
  context.kitsState.kitModalCompRows = [{ item_id: 1, qty: 1 }];
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
