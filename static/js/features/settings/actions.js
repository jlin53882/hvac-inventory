// 設定頁的事件委派（data-action="settings-*"）。標記只寫 data-action 與 data-*，不掛 window.Settings。
// 本檔只由 pages/settings.js 載入。

import { createActionDelegate } from '../../core/actions.js';
import { addCabinet, deleteCabinet, editCabinet, submitCabinetEdit } from './cabinets.js';
import { addGcalReminderRow, bindGcalUser, deleteGcalKey, forceSyncNow, removeGcalReminderRow, saveGcalSetting, saveKeyReminders, selectGcalKey, switchGcalTab, toggleGcalKey } from './gcal.js';
import { clearGcalFile, closeGcalKeyModal, gcalFileSelected, openGcalKeyModal, submitGcalKey } from './gcal-key-modal.js';
import { clearPwForm, settingsSubmitPw, settingsSwitch } from './page.js';
import { createPettyOptionKind } from './petty-options.js';
import { addUnitFromSettings, applyQtySuggest, consolidateGroup, consolidateItem, moveUnit, setUnitQtyType, toggleUnit } from './units.js';

const id = function(el) { return Number(el.dataset.id); };
const keyId = function(el) { return Number(el.dataset.keyId); };

const SETTINGS_ACTIONS = {
  'settings-switch': { click: function(el) { settingsSwitch(el.dataset.panel); } },
  // 單位
  'settings-unit-add': { click: function() { addUnitFromSettings(); } },
  'settings-unit-qty-type': { change: function(el) { setUnitQtyType(id(el), el.value); } },
  'settings-unit-move': { click: function(el) { moveUnit(id(el), Number(el.dataset.dir)); } },
  'settings-unit-toggle': { change: function(el) { toggleUnit(id(el), el.checked); } },
  'settings-unit-group-toggle': { click: function(el) { el.parentElement.classList.toggle('is-open'); } },
  'settings-unit-apply-suggest': { click: function(el) { applyQtySuggest(id(el), el); } },
  'settings-unit-consolidate-item': { click: function(el) { consolidateItem(id(el), el); } },
  'settings-unit-consolidate-group': { click: function(el) { consolidateGroup(el); } },
  // 櫃子
  'settings-cabinet-add': { click: function() { addCabinet(); } },
  'settings-cabinet-edit': { click: function(el) { editCabinet(id(el)); } },
  'settings-cabinet-delete': { click: function(el) { deleteCabinet(id(el)); } },
  'settings-cabinet-edit-submit': { click: function() { submitCabinetEdit(); } },
  // 零用金選單
  'settings-petty-option-create': { click: function(el) { createPettyOptionKind(el.dataset.scope, el.dataset.kind); } },
  // 修改密碼
  'settings-pw-submit': { click: function() { settingsSubmitPw(); } },
  'settings-pw-clear': { click: function() { clearPwForm(); } },
  // Google 行事曆
  'settings-gcal-force-sync': { click: function() { forceSyncNow(); } },
  'settings-gcal-key-select': { click: function(el) { selectGcalKey(id(el)); } },
  // 列上的停用 / 啟用按鈕在可點的 key 卡片裡：最近的 action 優先，不會再觸發 select
  'settings-gcal-key-toggle-button': { click: function(el) { toggleGcalKey(id(el), el.dataset.on === 'true'); } },
  'settings-gcal-key-toggle': { change: function(el) { toggleGcalKey(id(el), el.checked); } },
  'settings-gcal-key-open': { click: function(el) { openGcalKeyModal(el.dataset.id ? id(el) : undefined); } },
  'settings-gcal-key-delete': { click: function(el) { deleteGcalKey(id(el)); } },
  'settings-gcal-tab': { click: function(el) { switchGcalTab(el.dataset.tab); } },
  'settings-gcal-setting': { change: function(el) { saveGcalSetting(el.dataset.key, el.value); } },
  'settings-gcal-setting-checkbox': { change: function(el) { saveGcalSetting(el.dataset.key, el.checked ? '1' : '0'); } },
  'settings-gcal-reminder-add': { click: function(el) { addGcalReminderRow(keyId(el)); } },
  'settings-gcal-reminder-remove': { click: function(el) { removeGcalReminderRow(keyId(el), Number(el.dataset.index)); } },
  'settings-gcal-reminders-save': { click: function(el) { saveKeyReminders(keyId(el)); } },
  'settings-gcal-user-bind': { change: function(el) { bindGcalUser(id(el), el.value); } },
  'settings-gcal-file-selected': { change: function(el) { gcalFileSelected(el); } },
  'settings-gcal-file-clear': { click: function() { clearGcalFile(); } },
  'settings-gcal-key-submit': { click: function() { submitGcalKey(); } },
  'settings-gcal-key-close': { click: function() { closeGcalKeyModal(); } },
};

const delegate = createActionDelegate('settings-', SETTINGS_ACTIONS);

/** 測試入口：直接分派一個（模擬的）事件。 */
export const handleSettingsEvent = delegate.handle;

export const initSettingsActions = delegate.init;
