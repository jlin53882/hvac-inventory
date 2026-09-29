// 跨模組共用、會被其他模組改寫的狀態（issue #39：原本是全域變數）
export const pettyCashState = {
  pcDetail: null,
  pcModalOpenSeq: 0,
  pcModalSessionType: '',
  pcSaveInFlight: false,
  pcSaveInFlightToken: 0,
};
