/**
 * server/db/mysql.js — shared MySQL client for the Supabase -> MySQL
 * migration. One pool, used by DataStore.js, UserStore.js, and
 * server/db/store.js instead of each hand-rolling its own connection —
 * fixes the accidental fragmentation those three files already had
 * around their own separate getSB() implementations.
 *
 * getPool() mirrors the getSB() null-fallback contract used everywhere
 * else in this codebase: returns null if MySQL isn't configured (or
 * failed to initialize), so callers write the exact same
 * `if (pool) {...} else {...}` shape they already use for `if (sb) {...}`.
 *
 * Configure with either MYSQL_URL (a full connection string — what
 * Aiven/Railway/PlanetScale hand you) or discrete MYSQL_HOST/PORT/USER/
 * PASSWORD/DATABASE env vars. Neither set -> getPool() returns null and
 * every caller falls through to its next backend (Supabase or file).
 *
 * timezone: 'Z' is mandatory here, not cosmetic — every TIMESTAMP column
 * in sql/mysql_schema.sql assumes UTC, matching how the app already
 * treats every date as a UTC ISO string (new Date().toISOString()).
 * Without this, mysql2 converts using the server process's local
 * timezone on every read/write, silently corrupting timestamps.
 */
import mysql from 'mysql2/promise';

let _pool = null;
let _poolFailed = false;
let _poolFailedAt = 0;

// How long to wait before retrying pool creation after a failed attempt.
// Was previously a permanent latch (never retried without a process restart).
// Softened for mysqlMirror.js, which wants to notice "MySQL became reachable"
// without a restart (e.g. a managed MySQL instance that was briefly down when
// the server booted). Cheap: this only re-runs createPool(), it does not open
// a connection eagerly — mysql2 pools connect lazily on first query.
const POOL_RETRY_MS = parseInt(process.env.MYSQL_POOL_RETRY_MS || '300000', 10); // 5 min

export function getPool() {
  if (_pool) return _pool;
  if (_poolFailed) {
    if (Date.now() - _poolFailedAt < POOL_RETRY_MS) return null;
    // Retry window elapsed — clear the latch and try again below.
    _poolFailed = false;
  }

  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  const hasDiscreteConfig = process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE;
  if (!url && !hasDiscreteConfig) return null;

  try {
    const baseConfig = url
      ? { uri: url }
      : {
          host: process.env.MYSQL_HOST,
          port: parseInt(process.env.MYSQL_PORT || '3306', 10),
          user: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASSWORD,
          database: process.env.MYSQL_DATABASE,
        };
    _pool = mysql.createPool({
      ...baseConfig,
      timezone: 'Z',
      connectionLimit: parseInt(process.env.MYSQL_POOL_SIZE || '10', 10),
      waitForConnections: true,
      queueLimit: 0,
      // Aiven (and most managed MySQL) requires TLS; rejectUnauthorized:
      // false because these providers commonly present a cert chain that
      // isn't in Node's default trust store, not because the connection
      // is unencrypted — the same trust posture the app already uses for
      // Supabase's own Postgres connection elsewhere.
      ssl: process.env.MYSQL_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });
  } catch (e) {
    console.error('[mysql] pool init failed:', e.message);
    _poolFailed = true;
    _poolFailedAt = Date.now();
    return null;
  }
  return _pool;
}

// JSON/array columns need an explicit JSON.stringify — unlike reads (mysql2
// auto-parses JSON-typed columns back into JS values), writes don't
// auto-serialize a plain object/array passed as a query parameter.
function serializeValue(v) {
  if (v === undefined) return null;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export async function selectAll(table, { orderBy, limit } = {}) {
  const pool = getPool();
  if (!pool) return null;
  let sql = `SELECT * FROM \`${table}\``;
  if (orderBy) sql += ` ORDER BY \`${orderBy}\``;
  if (limit) sql += ` LIMIT ${parseInt(limit, 10)}`;
  const [rows] = await pool.query(sql);
  return rows;
}

export async function selectById(table, id, idColumn = 'id') {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE \`${idColumn}\` = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

export async function selectWhere(table, whereObj, { orderBy } = {}) {
  const pool = getPool();
  if (!pool) return null;
  const cols = Object.keys(whereObj || {});
  if (cols.length === 0) return selectAll(table, { orderBy });
  const clause = cols.map(c => `\`${c}\` = ?`).join(' AND ');
  const values = cols.map(c => whereObj[c]);
  let sql = `SELECT * FROM \`${table}\` WHERE ${clause}`;
  if (orderBy) sql += ` ORDER BY \`${orderBy}\``;
  const [rows] = await pool.query(sql, values);
  return rows;
}

export async function insertRow(table, row) {
  const pool = getPool();
  if (!pool) return null;
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map(c => serializeValue(row[c]));
  await pool.query(
    `INSERT INTO \`${table}\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})`,
    values
  );
  return row;
}

// INSERT ... ON DUPLICATE KEY UPDATE — the MySQL equivalent of Supabase's
// `.upsert(row, { onConflict: col })`. Requires `table` to have a
// PRIMARY KEY or UNIQUE constraint on the conflicting column(s) (every
// table in sql/mysql_schema.sql that the app upserts into has one).
export async function upsertRow(table, row, updateCols = null) {
  const pool = getPool();
  if (!pool) return null;
  const cols = Object.keys(row);
  const placeholders = cols.map(() => '?').join(', ');
  const values = cols.map(c => serializeValue(row[c]));
  const toUpdate = updateCols || cols.filter(c => !['id', 'user_id', 'company_id'].includes(c));
  const updateClause = toUpdate.length > 0
    ? toUpdate.map(c => `\`${c}\` = VALUES(\`${c}\`)`).join(', ')
    : `\`${cols[0]}\` = VALUES(\`${cols[0]}\`)`; // no-op update if every column is a key column
  await pool.query(
    `INSERT INTO \`${table}\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updateClause}`,
    values
  );
  return row;
}

export async function updateRow(table, id, updates, idColumn = 'id') {
  const pool = getPool();
  if (!pool) return null;
  const cols = Object.keys(updates || {});
  if (cols.length === 0) return null;
  const setClause = cols.map(c => `\`${c}\` = ?`).join(', ');
  const values = cols.map(c => serializeValue(updates[c]));
  await pool.query(`UPDATE \`${table}\` SET ${setClause} WHERE \`${idColumn}\` = ?`, [...values, id]);
  return { [idColumn]: id, ...updates };
}

export async function deleteRow(table, id, idColumn = 'id') {
  const pool = getPool();
  if (!pool) return false;
  const [result] = await pool.query(`DELETE FROM \`${table}\` WHERE \`${idColumn}\` = ?`, [id]);
  return result.affectedRows > 0;
}

// Transaction helper — used where a caller needs several writes to commit
// or roll back together (e.g. UserStore's manager-link + group-membership
// pair). `fn` receives a connection with the same query/execute methods
// as the pool, already inside BEGIN/COMMIT.
export async function withTransaction(fn) {
  const pool = getPool();
  if (!pool) return null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
