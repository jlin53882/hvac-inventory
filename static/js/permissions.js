// 權限矩陣（Permissions Matrix）— 與 docs/權限列表.md 同步
// ==================================================
// 資料來源：main.py 路由掛載 + app/services/auth.py 角色邏輯實際盤點
// 維護：任何權限異動時，同步更新本檔 + docs/權限列表.md
// 使用：getRolePerms(role) → [{label, allowed}]，供使用者管理 modal 顯示權限一覽

// 角色顯示名稱
var ROLE_LABELS = {
  admin: '👑 管理員',
  user: '👤 使用者',
  viewer: '👀 檢視者',
};

// 權限矩陣：每個權限項目各角色的可否（admin/user/viewer）
var PERMISSION_MATRIX = [
  { key: 'view',     label: '庫存瀏覽／搜尋／看照片',        roles: { admin: true,  user: true,  viewer: true  } },
  { key: 'stats',    label: '統計數字',                      roles: { admin: true,  user: true,  viewer: true  } },
  { key: 'kit-view', label: '整組清單瀏覽',                  roles: { admin: true,  user: true,  viewer: true  } },
  { key: 'prepared', label: '待領出／已領出清單瀏覽',        roles: { admin: true,  user: true,  viewer: true  } },
  { key: 'export',   label: '匯出 Excel 報表',               roles: { admin: true,  user: true,  viewer: true  } },
  { key: 'item-mgmt',label: '品項 新增／編輯／刪除',          roles: { admin: true,  user: true,  viewer: false } },
  { key: 'stock-mgmt',label: '庫存位置／數量 調整',           roles: { admin: true,  user: true,  viewer: false } },
  { key: 'import',   label: '匯入 JSON',                     roles: { admin: true,  user: true,  viewer: false } },
  { key: 'stockout', label: '出庫作業（直接出／待領出／退回）', roles: { admin: true, user: true, viewer: false } },
  { key: 'stocktake',label: '盤點作業（提交盤點）',           roles: { admin: true,  user: true,  viewer: false } },
  { key: 'kit-mgmt', label: '整組 建立／組裝／拆解',          roles: { admin: true,  user: true,  viewer: false } },
  { key: 'photo',    label: '照片 上傳／刪除',                roles: { admin: true,  user: true,  viewer: false } },
  { key: 'user-mgmt',label: '使用者管理',                    roles: { admin: true,  user: false, viewer: false } },
];

// 依角色回傳權限清單：[{label, allowed, key}]
function getRolePerms(role) {
  return PERMISSION_MATRIX.map(function (p) {
    return { key: p.key, label: p.label, allowed: !!p.roles[role] };
  });
}

// 依角色回傳「可以做」的權限 label 摘要（一行，供列表顯示）
function getRolePermSummary(role) {
  return getRolePerms(role)
    .filter(function (p) { return p.allowed; })
    .map(function (p) { return p.label; });
}
