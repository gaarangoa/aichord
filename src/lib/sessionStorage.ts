import type { ChatMessage, ChordNotebookEntry } from '@/types/harmony';

const DB_NAME = 'aichordSessions';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

const isBrowser = typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

export interface SessionData {
  messages: ChatMessage[];
  chordNotebook: ChordNotebookEntry[];
  chatInstructions: string;
  selectedAgentId: string;
  selectedModel: string;
  selectedProvider: string;
  relativeVelocity: number;
  bpm: number;
  octaveTranspose: number;
  transposeDisplay: boolean;
}

export interface SessionRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: SessionData;
}

const openDatabase = (): Promise<IDBDatabase> => {
  if (!isBrowser) {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });
};

const runRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });

export const getAllSessions = async (): Promise<SessionRecord[]> => {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, 'readonly');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.getAll();
  const result = await runRequest(request);
  return Array.isArray(result)
    ? (result as SessionRecord[]).sort((a, b) => b.updatedAt - a.updatedAt)
    : [];
};

export const getSession = async (id: string): Promise<SessionRecord | undefined> => {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, 'readonly');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.get(id);
  const result = await runRequest(request);
  return result ?? undefined;
};

export const saveSession = async (record: SessionRecord): Promise<void> => {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  store.put(record);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to save session'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Session save aborted'));
  });
};

export const deleteSession = async (id: string): Promise<void> => {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  store.delete(id);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to delete session'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Session delete aborted'));
  });
};
