export const LOCAL_GAME_SNAPSHOT_KEY = 'three_kingdoms_game_snapshot';

// D-9 C 类：存储层拒绝是诊断，不是游戏事实——诚实上报但永不反抛打断对局链
// （v2.3.2 八格矩阵：自动保存挂在 endTurn 提交路径上，裸 setItem 抛错会卡死回合）。
const warnedOps = new Set<string>();
function reportStorageFailure(op: string, error: unknown): void {
  if (warnedOps.has(op)) return;
  warnedOps.add(op);
  console.warn(`[LocalGameSnapshot] localStorage ${op} unavailable, game save degraded`, error);
}

export function __resetLocalGameSnapshotDiagnostics(): void {
  warnedOps.clear();
}

export function saveLocalGameSnapshot(data: string): boolean {
  try {
    localStorage.setItem(LOCAL_GAME_SNAPSHOT_KEY, data);
    return true;
  } catch (error) {
    reportStorageFailure('save', error);
    return false;
  }
}

export function readLocalGameSnapshot(): string | null {
  try {
    return localStorage.getItem(LOCAL_GAME_SNAPSHOT_KEY);
  } catch (error) {
    reportStorageFailure('read', error);
    return null;
  }
}

export function clearLocalGameSnapshot(): void {
  try {
    localStorage.removeItem(LOCAL_GAME_SNAPSHOT_KEY);
  } catch (error) {
    reportStorageFailure('clear', error);
  }
}
