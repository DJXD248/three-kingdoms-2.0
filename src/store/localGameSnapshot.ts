export const LOCAL_GAME_SNAPSHOT_KEY = 'three_kingdoms_game_snapshot';

export function saveLocalGameSnapshot(data: string): void {
  localStorage.setItem(LOCAL_GAME_SNAPSHOT_KEY, data);
}

export function readLocalGameSnapshot(): string | null {
  return localStorage.getItem(LOCAL_GAME_SNAPSHOT_KEY);
}

export function clearLocalGameSnapshot(): void {
  localStorage.removeItem(LOCAL_GAME_SNAPSHOT_KEY);
}
