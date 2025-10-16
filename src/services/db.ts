import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DB_NAME = 'awp-offline-db';
const DB_VERSION = 3;
const STORE_NAME = 'tasks';

export type OfflineTask = {
  id: number;
  title: string;
  description: string;
  createdAt: string;
  syncStatus: 'pending' | 'synced';
};

interface AppDB extends DBSchema {
  tasks: {
    key: number;
    value: OfflineTask;
    indexes: {
      'by-createdAt': string;
      'by-syncStatus': string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? transaction.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: 'id' });

        if (!store.indexNames.contains('by-createdAt')) {
          store.createIndex('by-createdAt', 'createdAt');
        }

        if (!store.indexNames.contains('by-syncStatus')) {
          store.createIndex('by-syncStatus', 'syncStatus');
        }

        if (oldVersion < 3) {
          const existing = await store.getAll();
          await Promise.all(
            existing.map((task) =>
              store.put({
                ...task,
                syncStatus: (task as OfflineTask).syncStatus ?? 'pending',
              }),
            ),
          );
        }
      },
    });
  }

  return dbPromise;
};

export const addTask = async (task: OfflineTask) => {
  const db = await getDb();
  await db.put(STORE_NAME, task);
};

export const getAllTasks = async () => {
  const db = await getDb();
  const tasks = await db.getAllFromIndex(STORE_NAME, 'by-createdAt');
  return tasks
    .map((task) => ({ ...task, syncStatus: task.syncStatus ?? 'pending' }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
};

export const getPendingTasks = async () => {
  const db = await getDb();
  return db.getAllFromIndex(STORE_NAME, 'by-syncStatus', 'pending');
};

export const deleteTasksByIds = async (ids: number[]) => {
  if (ids.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
};
