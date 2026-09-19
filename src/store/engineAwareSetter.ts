import { storeStateToEngineState } from './gameStateAdapter';

type StorePatch<T> =
  Partial<T> | ((current: T) => Partial<T>);
type StoreApply<T> =
  (updater: (current: T) => T, replace?: boolean) => void;

/**
 * Keeps legacy Zustand writes mirrored into EngineState while allowing
 * engine-backed actions to provide the authoritative state explicitly.
 */
export function createEngineAwareSetter<T>(
  apply: StoreApply<T>,
) {
  return (partial: StorePatch<T>, replace = false): void => {
    apply(current => {
      const patch = typeof partial === 'function' ? partial(current) : partial;
      const merged = (replace ? patch : { ...current, ...patch }) as T;

      if (Object.prototype.hasOwnProperty.call(patch, 'engineState')) {
        return merged;
      }

      return {
        ...merged,
        engineState: storeStateToEngineState(merged),
      };
    }, replace);
  };
}
