// Open the pre-built geodae SQLite database (Expo variant).
// Requires: expo-sqlite, expo-file-system, expo-asset
import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system";
import { Asset } from "expo-asset";

const DB_NAME = "geodae.db";

let _dbPromise = null;

export default function getDb() {
  if (!_dbPromise) {
    _dbPromise = initDb();
  }
  return _dbPromise;
}

async function initDb() {
  const sqliteDir = `${FileSystem.documentDirectory}SQLite`;
  const dbPath = `${sqliteDir}/${DB_NAME}`;

  // Ensure the SQLite directory exists
  const dirInfo = await FileSystem.getInfoAsync(sqliteDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(sqliteDir, { intermediates: true });
  }

  // Copy asset DB on first launch (or after app update clears documents)
  const fileInfo = await FileSystem.getInfoAsync(dbPath);
  if (!fileInfo.exists) {
    const asset = Asset.fromModule(require("../assets/db/geodae.db"));
    await asset.downloadAsync();
    await FileSystem.copyAsync({ from: asset.localUri, to: dbPath });
  }

  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // Read-only optimizations
  await db.execAsync("PRAGMA journal_mode = WAL");
  await db.execAsync("PRAGMA cache_size = -8000"); // 8 MB
  return db;
}
