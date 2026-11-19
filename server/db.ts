import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
export interface Sql {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}
export interface Db extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: string;
}
export async function createDb(location?: string): Promise<Db> {
  let db: Db;
  if (location?.startsWith("postgres")) {
    const pool = new pg.Pool({
      connectionString: location,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on("error", (err) => {
      console.error("[pg.Pool] idle client error:", err.message);
    });
    db = {
      kind: "postgresql",
      query: async (sql, p) => pool.query(sql, p),
      transaction: async (fn) => {
        const c = await pool.connect();
        let releaseErr: Error | undefined;
        try {
          await c.query("BEGIN");
          const r = await fn(c);
          await c.query("COMMIT");
          return r;
        } catch (e) {
          try {
            await c.query("ROLLBACK");
          } catch (rbErr) {
            releaseErr = rbErr instanceof Error ? rbErr : new Error(String(rbErr));
          }
          throw e;
        } finally {
          c.release(releaseErr);
        }
      },
      close: () => pool.end(),
    };
  } else {
    const p = new PGlite(location);
    await p.waitReady;
    let chain = Promise.resolve();
    const serial = <T>(fn: () => Promise<T>) => {
      const next = chain.then(fn, fn);
      chain = next.then(
        () => {},
        () => {},
      );
      return next;
    };
    db = {
      kind: "pglite",
      query: (s, v) => serial(() => p.query(s, v)),
      transaction: (fn) => serial(() => p.transaction((tx) => fn(tx))),
      close: () => p.close(),
    };
  }
  await db.query(
    `CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,data JSONB NOT NULL);`,
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,expires BIGINT NOT NULL);`,
  );
  await db.query(`CREATE TABLE IF NOT EXISTS participant_sessions(token_hash TEXT PRIMARY KEY, activity_id TEXT NOT NULL, person_id TEXT NOT NULL, code_hash TEXT NOT NULL, expires BIGINT NOT NULL)`);
  await db.query("CREATE INDEX IF NOT EXISTS participant_sessions_expires ON participant_sessions(expires)");
  return db;
}
