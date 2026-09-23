// SQLite API bridge; transactions retain rollback behavior across async calls.
export function durableDatabase(storage) {
  let initializing = true;
  const db = {
    dialect: 'durable-sqlite',
    prepare(sql) {
      return {
        all: (...values) => storage.sql.exec(sql, ...values).toArray(),
        get: (...values) => storage.sql.exec(sql, ...values).toArray()[0],
        run: (...values) => {
          storage.sql.exec(sql, ...values).toArray();
          return storage.sql.exec('SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid').one();
        },
      };
    },
    exec: (sql) => { storage.sql.exec(sql).toArray(); },
    transaction: (callback) => initializing
      ? storage.transactionSync(callback)
      : storage.transaction(callback),
    finishInitialization: () => { initializing = false; },
    healthCheck: () => storage.sql.exec('SELECT 1 AS ok').one().ok === 1,
    ready: Promise.resolve(),
  };
  return db;
}
