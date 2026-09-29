// 跨模組共用、會被其他模組改寫的狀態（issue #39：原本是全域變數）
export const inventoryState = {
  stockLocationPickerState: null, // pending item and delta while choosing a location
  inventoryStatusRequestSeq: 0,
  inventoryStatusModalType: '',
};
