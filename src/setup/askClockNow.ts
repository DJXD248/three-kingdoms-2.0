/**
 * 问窗那把表的"现在"读数。
 *
 * 全树倒计时这条线，唯一真正读表的地方是 `AskClockDirector`——它每拍把取到的那一刻
 * 写入这里；HUD 来取这个数去算还剩几秒。表没跑过＝0，于是 HUD 在锚为 `null` 时整块
 * 不显示秒数（热座／测试台／没开窗都是这一形）。
 *
 * 这层单独成文件，是因为 `AskClockDirector` 既导出了 React 组件、又导出这个读数函数，
 * 会触发 `react-refresh/only-export-components`——组件文件只许导出组件，读数这种非组件
 * 的值要另立门户。
 */
let lastSampleMs = 0;

/** 画面那一行用的"现在"＝上一拍写入的那一个数。 */
export function askClockNowMs(): number {
  return lastSampleMs;
}

/** 由 AskClockDirector 的表每拍写入；只此一处更新。 */
export function setAskClockNowMs(ms: number): void {
  lastSampleMs = ms;
}
