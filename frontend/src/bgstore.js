/**
 * 界面设置里的「页面背景图」存哪儿：**只存本机浏览器的 IndexedDB**，绝不上传服务器。
 *
 * 站长 2026-09-27 的要求：「背景图片不要存服务器上，存本地」。
 * 为什么不用 localStorage：它只能存字符串，图片转 base64 会膨胀 33%，而且配额通常只有 5MB 左右，
 * 一张手机直出的图就爆了；IndexedDB 能直接存 Blob，配额按域名给（通常几百 MB）。
 *
 * 用法：
 *   await bgGet()          -> Blob | null
 *   await bgSet(fileOrBlob)
 *   await bgClear()
 * 隐私模式 / 禁用存储时这些调用会抛错，调用方要 try/catch 并给用户明确提示。
 */
const DB_NAME = 'kitterhub_ui';
const STORE = 'kv';
const KEY = 'page-bg';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexedDB open failed'));
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function bgGet() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = tx(db, 'readonly').get(KEY);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function bgSet(blob) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const req = tx(db, 'readwrite').put(blob, KEY);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function bgClear() {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const req = tx(db, 'readwrite').delete(KEY);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
