import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB_PATH = './data/cafepunch.sqlite';
const dbPath = path.resolve(process.env.SQLITE_DB_PATH || DEFAULT_DB_PATH);
const dbDir = path.dirname(dbPath);

fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function nowText() {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const bj = new Date(utc + 8 * 3600000);
  const y = bj.getFullYear();
  const m = String(bj.getMonth() + 1).padStart(2, '0');
  const day = String(bj.getDate()).padStart(2, '0');
  const h = String(bj.getHours()).padStart(2, '0');
  const min = String(bj.getMinutes()).padStart(2, '0');
  const sec = String(bj.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${sec}`;
}

function withId(row) {
  if (!row) return null;
  return { ...row, id: row.id, _id: row.id };
}

function normalizeRows(rows) {
  return rows.map(withId);
}

function toInt(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : 0;
}

function cleanData(data, allowedColumns) {
  const cleaned = {};
  for (const key of allowedColumns) {
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      cleaned[key] = data[key];
    }
  }
  return cleaned;
}

function insertRow(table, data) {
  const keys = Object.keys(data).filter(key => data[key] !== undefined);
  const columns = keys.join(', ');
  const params = keys.map(key => `@${key}`).join(', ');
  const info = db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${params})`).run(data);
  return getById(table, info.lastInsertRowid);
}

function updateRow(table, id, data) {
  const keys = Object.keys(data).filter(key => data[key] !== undefined);
  if (keys.length === 0) return getById(table, id);

  const sets = keys.map(key => `${key} = @${key}`).join(', ');
  const info = db.prepare(`UPDATE ${table} SET ${sets} WHERE id = @id`).run({ ...data, id: toInt(id) });
  if (info.changes === 0) return null;
  return getById(table, id);
}

function getById(table, id) {
  return withId(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(toInt(id)));
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      member_name TEXT NOT NULL,
      date TEXT NOT NULL,
      check_in TEXT,
      check_out TEXT,
      device_id TEXT,
      source_ip TEXT,
      is_voided INTEGER DEFAULT 0,
      void_reason TEXT,
      voided_at TEXT,
      voided_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS adjustment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      member_name TEXT NOT NULL,
      date TEXT NOT NULL,
      request_type TEXT NOT NULL,
      requested_check_in TEXT,
      requested_check_out TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_note TEXT,
      device_id TEXT,
      created_at TEXT,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      password_hash TEXT NOT NULL,
      token TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
    CREATE INDEX IF NOT EXISTS idx_records_member_date ON records(member_id, date);
    CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
    CREATE INDEX IF NOT EXISTS idx_adjustments_status ON adjustment_requests(status);
    CREATE INDEX IF NOT EXISTS idx_adjustments_member_date ON adjustment_requests(member_id, date);
  `);

  return [
    { name: 'members', status: 'ready' },
    { name: 'records', status: 'ready' },
    { name: 'adjustment_requests', status: 'ready' },
    { name: 'admins', status: 'ready' },
  ];
}

export function ensureCollections() {
  return initDatabase();
}

export async function listActiveMembers() {
  return normalizeRows(db.prepare(`
    SELECT id, name, status, created_at, updated_at
    FROM members
    WHERE status = 'active'
    ORDER BY id ASC
  `).all());
}

export async function listAllMembers() {
  return normalizeRows(db.prepare(`
    SELECT id, name, status, created_at, updated_at
    FROM members
    ORDER BY id ASC
  `).all());
}

export async function createMember(name, now = nowText()) {
  return insertRow('members', {
    name,
    status: 'active',
    created_at: now,
    updated_at: now,
  });
}

export async function updateMember(id, data) {
  return updateRow('members', id, cleanData(data, ['name', 'status', 'created_at', 'updated_at']));
}

export async function deactivateMember(id, now = nowText()) {
  return updateMember(id, { status: 'inactive', updated_at: now });
}

export async function getActiveMemberById(id) {
  return withId(db.prepare(`
    SELECT id, name, status, created_at, updated_at
    FROM members
    WHERE id = ? AND status = 'active'
    LIMIT 1
  `).get(toInt(id)));
}

export async function findActiveMemberByName(name) {
  return withId(db.prepare(`
    SELECT id, name, status, created_at, updated_at
    FROM members
    WHERE name = ? AND status = 'active'
    LIMIT 1
  `).get(name));
}

export async function getTodayRecord(memberId, date) {
  return withId(db.prepare(`
    SELECT * FROM records
    WHERE member_id = ? AND date = ? AND COALESCE(is_voided, 0) = 0
    ORDER BY id DESC
    LIMIT 1
  `).get(toInt(memberId), date));
}

export async function createCheckinRecord(data) {
  return createRecord(data);
}

export async function checkoutRecord(recordId, checkOut, options = {}) {
  return updateRecord(recordId, {
    check_out: checkOut,
    updated_at: options.updated_at || checkOut,
  });
}

export async function listAdminRecords() {
  return normalizeRows(db.prepare(`
    SELECT * FROM records
    ORDER BY date DESC, member_name ASC, id DESC
  `).all());
}

export async function findRecordByMemberAndDate(memberId, date) {
  return withId(db.prepare(`
    SELECT * FROM records
    WHERE member_id = ? AND date = ? AND COALESCE(is_voided, 0) = 0
    ORDER BY id DESC
    LIMIT 1
  `).get(toInt(memberId), date));
}

export async function createRecord(data) {
  const now = nowText();
  return insertRow('records', {
    member_id: toInt(data.member_id),
    member_name: data.member_name,
    date: data.date,
    check_in: data.check_in ?? null,
    check_out: data.check_out ?? null,
    device_id: data.device_id ?? null,
    source_ip: data.source_ip ?? null,
    is_voided: data.is_voided ?? 0,
    void_reason: data.void_reason ?? null,
    voided_at: data.voided_at ?? null,
    voided_by: data.voided_by ?? null,
    created_at: data.created_at ?? now,
    updated_at: data.updated_at ?? now,
  });
}

export async function updateRecord(recordId, data) {
  return updateRow(
    'records',
    recordId,
    cleanData(data, [
      'member_id',
      'member_name',
      'date',
      'check_in',
      'check_out',
      'device_id',
      'source_ip',
      'is_voided',
      'void_reason',
      'voided_at',
      'voided_by',
      'created_at',
      'updated_at',
    ]),
  );
}

export async function voidRecord(id, reason, voidedAt, voidedBy) {
  return updateRecord(id, {
    is_voided: 1,
    void_reason: reason,
    voided_at: voidedAt,
    voided_by: voidedBy,
    updated_at: voidedAt,
  });
}

export async function listRecordsByMonth(month) {
  const [y, m] = month.split('-');
  const start = `${y}-${m}-01`;
  const lastDay = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
  const end = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;

  return normalizeRows(db.prepare(`
    SELECT * FROM records
    WHERE date >= ? AND date <= ? AND COALESCE(is_voided, 0) = 0
    ORDER BY member_name ASC, date ASC, id ASC
  `).all(start, end));
}

export async function createAdjustmentRequest(data) {
  return insertRow('adjustment_requests', {
    member_id: toInt(data.member_id),
    member_name: data.member_name,
    date: data.date,
    request_type: data.request_type,
    requested_check_in: data.requested_check_in ?? null,
    requested_check_out: data.requested_check_out ?? null,
    reason: data.reason,
    status: data.status ?? 'pending',
    admin_note: data.admin_note ?? null,
    device_id: data.device_id ?? null,
    created_at: data.created_at ?? nowText(),
    reviewed_at: data.reviewed_at ?? null,
  });
}

export async function listAdjustmentRequests(status) {
  const rows = status
    ? db.prepare(`
        SELECT * FROM adjustment_requests
        WHERE status = ?
        ORDER BY created_at DESC, id DESC
      `).all(status)
    : db.prepare(`
        SELECT * FROM adjustment_requests
        ORDER BY created_at DESC, id DESC
      `).all();

  return normalizeRows(rows);
}

export async function getAdjustmentRequestById(id) {
  return getById('adjustment_requests', id);
}

export async function updateAdjustmentRequest(id, data) {
  return updateRow(
    'adjustment_requests',
    id,
    cleanData(data, [
      'member_id',
      'member_name',
      'date',
      'request_type',
      'requested_check_in',
      'requested_check_out',
      'reason',
      'status',
      'admin_note',
      'device_id',
      'created_at',
      'reviewed_at',
    ]),
  );
}

export async function getAdmin() {
  return withId(db.prepare(`
    SELECT * FROM admins
    ORDER BY id ASC
    LIMIT 1
  `).get());
}

export async function getAdminByToken(token) {
  return withId(db.prepare(`
    SELECT * FROM admins
    WHERE token = ?
    ORDER BY id ASC
    LIMIT 1
  `).get(token));
}

export async function createDefaultAdminIfNotExists(passwordHash, now = nowText()) {
  const existing = await getAdmin();
  if (existing) return { created: false, admin: existing };

  const admin = insertRow('admins', {
    password_hash: passwordHash,
    token: null,
    created_at: now,
    updated_at: now,
  });

  return { created: true, admin };
}

export async function updateAdminPassword(passwordHash, now = nowText()) {
  const admin = await getAdmin();
  if (!admin) return null;

  return updateRow('admins', admin.id, {
    password_hash: passwordHash,
    token: null,
    updated_at: now,
  });
}

export async function updateAdminToken(token, now = nowText()) {
  const admin = await getAdmin();
  if (!admin) return null;

  return updateRow('admins', admin.id, {
    token,
    updated_at: now,
  });
}

initDatabase();

export default {
  initDatabase,
  ensureCollections,
  listActiveMembers,
  listAllMembers,
  createMember,
  updateMember,
  deactivateMember,
  getActiveMemberById,
  findActiveMemberByName,
  getTodayRecord,
  createCheckinRecord,
  checkoutRecord,
  listAdminRecords,
  findRecordByMemberAndDate,
  createRecord,
  updateRecord,
  voidRecord,
  listRecordsByMonth,
  createAdjustmentRequest,
  listAdjustmentRequests,
  getAdjustmentRequestById,
  updateAdjustmentRequest,
  getAdmin,
  getAdminByToken,
  createDefaultAdminIfNotExists,
  updateAdminPassword,
  updateAdminToken,
};
