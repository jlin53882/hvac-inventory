// 照片區 runtime 契約：執行真實的 features/inventory/photo.js（renderPhotoBox / uploadItemPhoto / deleteItemPhoto /
// 預覽式照片區），驗證 boxId 傳遞、listener 在重繪前被呼叫、上傳失敗路徑與不合規檔案不清掉另一個 input。
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installApiClient, loadModules, mockResponse, seedReadModels } = require('./support/frontend-runtime');

const elements = {};
const calls = { fetch: [], toast: [], order: [] };
let nextFetch = () => mockResponse({ ok: true });

class TestFormData {
  constructor() { this.entries = []; }
  append(name, value) { this.entries.push({ name, value }); }
}

const context = vm.createContext({
  console,
  appState: { currentSite: 'office' },
  document: {
    addEventListener() {},
    getElementById: (id) => elements[id] || null,
    createElement: () => ({ append() {}, addEventListener() {} }),
  },
  fetch: async (url, options = {}) => {
    calls.fetch.push({ url, method: options.method || 'GET' });
    return nextFetch(url, options);
  },
  FormData: TestFormData,
  hasPerm: () => true,
  esc: (value) => String(value ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
  photoSrc: (id, size) => `/media/item-${id}/${size}`,
  toast: (message, kind) => calls.toast.push({ message, kind }),
  renderInventoryView: () => {},
  loadData: async () => {},
  Qty: {},
});
installApiClient(context);
loadModules(context, 'features/inventory/photo.js');
seedReadModels(context, { allItems: [{ id: 5, has_photo: false }], preparedItems: [] });

const goodFile = { name: 'ok.jpg', size: 1024 };
const badFile = { name: 'bad.gif', size: 1024 };

function resetBox(id) {
  elements[id] = { innerHTML: '' };
  return elements[id];
}

/** renderPhotoBox 預設是單一庫存編輯 modal，boxId 有傳時 data-box 要帶出去（供 upload/delete 找回同一個照片區）。 */
function verifyBoxIdIsCarriedIntoMarkup() {
  const editBox = resetBox('e-photo-box');
  const preparedBox = resetBox('pe-photo-box');
  context.renderPhotoBox(5, false);
  context.renderPhotoBox(9, true, 'pe-photo-box');
  assert.match(editBox.innerHTML, /data-action="inventory-photo-upload" data-id="5" data-box="e-photo-box"/);
  assert.match(preparedBox.innerHTML, /data-action="inventory-photo-upload" data-id="9" data-box="pe-photo-box"/);
  assert.match(preparedBox.innerHTML, /data-action="inventory-photo-delete" data-id="9" data-box="pe-photo-box"/);
}

/** 上傳成功：listener 先拿到含新網址的 patch，之後才重繪該 boxId 的照片區，input 重置。 */
async function verifyUploadNotifiesListenerBeforeRender() {
  const preparedBox = resetBox('pe-photo-box');
  let htmlAtListener = null;
  context.onItemPhotoChange('pe-photo-box', (itemId, patch) => {
    htmlAtListener = preparedBox.innerHTML;
    calls.order.push([itemId, patch]);
  });
  nextFetch = () => mockResponse({ ok: true, asset_id: 'a1', thumbnail_url: '/media/a1/thumbnail', preview_url: '/media/a1/preview' });
  const input = { files: [goodFile], dataset: { box: 'pe-photo-box' }, value: 'x' };
  await context.uploadItemPhoto(9, input);

  const [itemId, patch] = calls.order.at(-1);
  assert.equal(itemId, 9);
  assert.equal(patch.thumbnail_url, '/media/a1/thumbnail');
  assert.equal(htmlAtListener, '', 'listener must run before the photo box is re-rendered');
  assert.match(preparedBox.innerHTML, /data-action="inventory-photo-delete" data-id="9" data-box="pe-photo-box"/);
  assert.equal(input.value, '', 'same file must be selectable again');
}

/** 刪除：listener 收到清空的 patch，照片區回到「尚無照片」。 */
async function verifyDeleteNotifiesListener() {
  const preparedBox = resetBox('pe-photo-box');
  let patchSeen = null;
  context.onItemPhotoChange('pe-photo-box', (itemId, patch) => { patchSeen = patch; });
  nextFetch = () => mockResponse({ ok: true });
  await context.deleteItemPhoto(9, 'pe-photo-box');
  assert.equal(patchSeen.has_photo, false);
  assert.equal(patchSeen.thumbnail_url, null);
  assert.match(preparedBox.innerHTML, /尚無照片/);
  assert.equal(calls.fetch.at(-1).method, 'DELETE');
}

/** 預覽式照片區：上傳失敗只提示（品項已建立）；沒選檔不發請求。 */
async function verifyPendingUploadPaths() {
  resetBox('nsp-photo-box');
  context.renderPendingPhotoBox('nsp-photo');
  assert.match(elements['nsp-photo-box'].innerHTML, /id="nsp-photo-input"/);
  assert.match(elements['nsp-photo-box'].innerHTML, /id="nsp-photo-album"/);
  assert.match(elements['nsp-photo-box'].innerHTML, /data-action="inventory-pending-photo-preview" data-box="nsp-photo"/);

  const fetchCount = calls.fetch.length;
  elements['nsp-photo-input'] = { files: [], value: '' };
  elements['nsp-photo-album'] = { files: [], value: '' };
  assert.equal(await context.uploadPendingPhoto(33, 'nsp-photo'), false);
  assert.equal(calls.fetch.length, fetchCount, 'no chosen file means no request');

  elements['nsp-photo-album'].files = [goodFile];
  nextFetch = () => mockResponse({ detail: '圖片儲存失敗' }, 500);
  assert.equal(await context.uploadPendingPhoto(33, 'nsp-photo'), false);
  assert.match(calls.toast.at(-1).message, /品項已建立，但照片上傳失敗/);
  assert.equal(calls.fetch.at(-1).url, '/api/items/33/photo');

  nextFetch = () => mockResponse({ ok: true });
  assert.equal(await context.uploadPendingPhoto(33, 'nsp-photo'), true);
}

/** 不合規檔案只清掉這次的選擇；另一個 input 已選好的合規照片與預覽保留。 */
function verifyInvalidPickKeepsOtherInput() {
  const preview = { innerHTML: '<img>' };
  const album = { id: 'nsp-photo-album', files: [goodFile], value: 'keep', dataset: { box: 'nsp-photo' } };
  const camera = { id: 'nsp-photo-input', files: [badFile], value: 'bad', dataset: { box: 'nsp-photo' } };
  elements['nsp-photo-preview'] = preview;
  elements['nsp-photo-message'] = { style: {} };
  elements['nsp-photo-input'] = camera;
  elements['nsp-photo-album'] = album;
  context.previewPendingPhoto(camera);
  assert.equal(camera.value, '', 'the rejected pick is cleared');
  assert.equal(album.value, 'keep', 'the other input keeps its valid file');
  assert.equal(preview.innerHTML, '<img>', 'existing valid preview stays');
  assert.match(calls.toast.at(-1).message, /不支援的圖片格式/);

  // 另一個 input 沒有檔案時，不合規的選擇會連預覽一起清乾淨
  album.files = [];
  camera.files = [badFile];
  context.previewPendingPhoto(camera);
  assert.equal(preview.innerHTML, '');
}

(async () => {
  verifyBoxIdIsCarriedIntoMarkup();
  await verifyUploadNotifiesListenerBeforeRender();
  await verifyDeleteNotifiesListener();
  await verifyPendingUploadPaths();
  verifyInvalidPickKeepsOtherInput();
  console.log('photo box runtime contract passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
