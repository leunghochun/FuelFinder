import { readFile } from 'node:fs/promises';

export type SnapshotStore = {
  getSnapshot(): Promise<unknown>;
  replace(snapshot: unknown): void;
};

export function createSnapshotStore(filePath: string): SnapshotStore {
  let snapshot: unknown;
  let hasSnapshot = false;
  let loading: Promise<unknown> | undefined;

  function getSnapshot(): Promise<unknown> {
    if (hasSnapshot) return Promise.resolve(snapshot);
    if (!loading) {
      loading = readFile(filePath, 'utf8')
        .then((contents) => JSON.parse(contents) as unknown)
        .then((loadedSnapshot) => {
          if (!hasSnapshot) {
            snapshot = loadedSnapshot;
            hasSnapshot = true;
          }
          return snapshot;
        })
        .catch((error: unknown) => {
          loading = undefined;
          throw error;
        });
    }
    return loading;
  }

  function replace(nextSnapshot: unknown): void {
    snapshot = nextSnapshot;
    hasSnapshot = true;
    loading = Promise.resolve(nextSnapshot);
  }

  return { getSnapshot, replace };
}