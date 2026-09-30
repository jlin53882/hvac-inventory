// 權限管理頁的事件委派（data-action="perms-*"）。標記只寫 data-action 與 data-*，不掛 window.Perms。
// 本檔只由 pages/permissions.js 載入。

import { createActionDelegate } from '../../core/actions.js';
import {
  addUserMode, closeAccountEditModal, closeAddUserModal, closeResetPermModal, closeResetPwModal, confirmResetPerm,
  openAddUserModal, openResetPermModal, permDelete, permEditAccount, permFilter, permPage, permPageToggle, permResetPw,
  permSave, permSearch, permSelect, permSubTab, permSwitchTab, permToggle, permToggleActive, submitAccountEdit,
  submitAddUser, submitResetPw,
} from './page.js';

const userId = function(el) { return Number(el.dataset.id); };

const PERMS_ACTIONS = {
  'perms-select': { click: function(el) { permSelect(userId(el)); } },
  'perms-subtab': { click: function(el) { permSubTab(el.dataset.view); } },
  'perms-switch-tab': { click: function(el) { permSwitchTab(el.dataset.tab); } },
  'perms-reset-perm-open': { click: function() { openResetPermModal(); } },
  'perms-reset-perm-close': { click: function() { closeResetPermModal(); } },
  'perms-reset-perm-confirm': { click: function() { confirmResetPerm(); } },
  'perms-save': { click: function() { permSave(); } },
  'perms-search': { input: function(el) { permSearch(el.value); } },
  'perms-filter': { click: function(el) { permFilter(el.dataset.module); } },
  'perms-toggle': { change: function(el) { permToggle(el.dataset.key, el.checked); } },
  'perms-page': { click: function(el) { permPage(Number(el.dataset.delta)); } },
  'perms-page-toggle': { change: function(el) { permPageToggle(el.dataset.pageKey, el.checked); } },
  'perms-edit-account': { click: function(el) { permEditAccount(userId(el)); } },
  'perms-reset-pw': { click: function(el) { permResetPw(userId(el)); } },
  'perms-toggle-active': { click: function(el) { permToggleActive(userId(el), Number(el.dataset.next)); } },
  'perms-delete': { click: function(el) { permDelete(userId(el)); } },
  'perms-add-user-open': { click: function() { openAddUserModal(); } },
  'perms-add-user-mode': { click: function(el) { addUserMode(el.dataset.mode); } },
  'perms-add-user-close': { click: function() { closeAddUserModal(); } },
  'perms-add-user-submit': { click: function() { submitAddUser(); } },
  'perms-account-edit-close': { click: function() { closeAccountEditModal(); } },
  'perms-account-edit-submit': { click: function() { submitAccountEdit(); } },
  'perms-reset-pw-close': { click: function() { closeResetPwModal(); } },
  'perms-reset-pw-submit': { click: function() { submitResetPw(); } },
};

const delegate = createActionDelegate('perms-', PERMS_ACTIONS);

/** 測試入口：直接分派一個（模擬的）事件。 */
export const handlePermsEvent = delegate.handle;

export const initPermsActions = delegate.init;
