// Open the pre-built geodae SQLite database (Bare RN variant).
// Requires: @op-engineering/op-sqlite
// Install: npm install @op-engineering/op-sqlite
// Place geodae.db in:
//   Android: android/app/src/main/assets/geodae.db
//   iOS:     add geodae.db to Xcode project "Copy Bundle Resources"
import { open } from "@op-engineering/op-sqlite";

let _db = null;

export default function getDb() {
  if (!_db) {
    _db = open({ name: "geodae.db", readOnly: true });
    _db.execute("PRAGMA cache_size = -8000"); // 8 MB
  }
  return _db;
}
