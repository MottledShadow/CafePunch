import cloudbase from '@cloudbase/node-sdk';

const COLLECTIONS = ['members', 'records', 'adjustment_requests', 'admins'];
const PAGE_SIZE = 100;
const SDK_TIMEOUT_MS = Number(process.env.CLOUDBASE_TIMEOUT_MS || 2500);
const ADMIN_DOC_ID = 'default_admin';

const initConfig = {
  env: process.env.CLOUDBASE_ENV_ID || cloudbase.SYMBOL_CURRENT_ENV,
  timeout: SDK_TIMEOUT_MS,
};

if (process.env.TENCENTCLOUD_SECRETID && process.env.TENCENTCLOUD_SECRETKEY) {
  initConfig.secretId = process.env.TENCENTCLOUD_SECRETID;
  initConfig.secretKey = process.env.TENCENTCLOUD_SECRETKEY;
}

const app = cloudbase.init(initConfig);
const db = app.database();
const _ = db.command;

function collection(name) {
  return db.collection(name);
}

function withDbTimeout(label, promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`CloudBase request timed out after ${SDK_TIMEOUT_MS}ms: ${label}`));
    }, SDK_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function withId(doc) {
  if (!doc) return null;
  return { ...doc, id: doc.id || doc._id };
}

function normalizeList(list) {
  return (list || []).map(withId);
}

function firstDoc(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function isAlreadyExistsError(error) {
  const text = String(error?.message || error?.code || error || '').toLowerCase();
  return text.includes('exist') || text.includes('already') || text.includes('duplicate') || text.includes('已存在');
}

async function ensureCollections() {
  const results = [];
  const autoCreate = process.env.CLOUDBASE_AUTO_CREATE_COLLECTIONS === 'true';

  for (const name of COLLECTIONS) {
    if (!autoCreate) {
      results.push({ name, status: 'manual_required' });
      continue;
    }

    if (typeof db.createCollection !== 'function') {
      results.push({ name, status: 'manual_required' });
      continue;
    }

    try {
      await withDbTimeout(`createCollection:${name}`, db.createCollection(name));
      results.push({ name, status: 'created' });
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        results.push({ name, status: 'exists' });
      } else {
        throw error;
      }
    }
  }

  return results;
}

async function queryAll(name, query = {}, options = {}) {
  const results = [];
  let offset = 0;

  while (true) {
    let ref = collection(name).where(query);

    for (const [field, direction] of options.orderBy || []) {
      ref = ref.orderBy(field, direction);
    }

    const res = await withDbTimeout(`${name}.queryAll`, ref.skip(offset).limit(PAGE_SIZE).get());
    const data = res.data || [];
    results.push(...data);

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return normalizeList(results);
}

async function queryOne(name, query = {}, options = {}) {
  let ref = collection(name).where(query);

  for (const [field, direction] of options.orderBy || []) {
    ref = ref.orderBy(field, direction);
  }

  const res = await withDbTimeout(`${name}.queryOne`, ref.limit(1).get());
  return withId((res.data || [])[0] || null);
}

async function getById(name, id) {
  if (!id) return null;

  try {
    const res = await withDbTimeout(`${name}.doc(${id}).get`, collection(name).doc(String(id)).get());
    return withId(firstDoc(res.data));
  } catch (error) {
    const text = String(error?.message || error?.code || error || '').toLowerCase();
    if (text.includes('not found') || text.includes('document')) return null;
    throw error;
  }
}

async function addDocument(name, data) {
  const res = await withDbTimeout(`${name}.add`, collection(name).add(data));
  const id = res.id || res._id;
  return getById(name, id);
}

async function setDocument(name, id, data) {
  await withDbTimeout(`${name}.doc(${id}).set`, collection(name).doc(String(id)).set(data));
  return getById(name, id);
}

async function updateDocument(name, id, data) {
  try {
    await withDbTimeout(`${name}.doc(${id}).update`, collection(name).doc(String(id)).update(data));
  } catch (error) {
    const text = String(error?.message || error?.code || error || '').toLowerCase();
    if (text.includes('not found') || text.includes('document')) return null;
    throw error;
  }
  return getById(name, id);
}

function monthRange(month) {
  const [y, m] = month.split('-');
  const start = `${y}-${m}-01`;
  const lastDay = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
  const end = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

export async function listActiveMembers() {
  return queryAll('members', { status: 'active' }, { orderBy: [['created_at', 'asc']] });
}

export async function listAllMembers() {
  return queryAll('members', {}, { orderBy: [['created_at', 'asc']] });
}

export async function createMember(name, now) {
  return addDocument('members', {
    name,
    status: 'active',
    created_at: now,
    updated_at: now,
  });
}

export async function updateMember(id, data) {
  return updateDocument('members', id, data);
}

export async function deactivateMember(id, now) {
  return updateMember(id, { status: 'inactive', updated_at: now });
}

export async function getActiveMemberById(id) {
  const member = await getById('members', id);
  return member && member.status === 'active' ? member : null;
}

export async function findActiveMemberByName(name) {
  return queryOne('members', { name, status: 'active' });
}

export async function getTodayRecord(memberId, date) {
  return queryOne('records', { member_id: String(memberId), date }, { orderBy: [['created_at', 'desc']] });
}

export async function createCheckinRecord(data) {
  return addDocument('records', data);
}

export async function checkoutRecord(recordId, checkOut, options = {}) {
  return updateDocument('records', recordId, {
    check_out: checkOut,
    updated_at: options.updated_at || checkOut,
  });
}

export async function listAdminRecords() {
  return queryAll('records', {}, { orderBy: [['date', 'desc'], ['member_name', 'asc']] });
}

export async function findRecordByMemberAndDate(memberId, date) {
  return queryOne('records', { member_id: String(memberId), date }, { orderBy: [['created_at', 'desc']] });
}

export async function createRecord(data) {
  return addDocument('records', data);
}

export async function updateRecord(recordId, data) {
  return updateDocument('records', recordId, data);
}

export async function listRecordsByMonth(month) {
  const { start, end } = monthRange(month);

  try {
    return await queryAll(
      'records',
      { date: _.gte(start).and(_.lte(end)) },
      { orderBy: [['member_name', 'asc'], ['date', 'asc']] },
    );
  } catch {
    const all = await queryAll('records', {}, { orderBy: [['member_name', 'asc'], ['date', 'asc']] });
    return all.filter(record => record.date >= start && record.date <= end);
  }
}

export async function createAdjustmentRequest(data) {
  return addDocument('adjustment_requests', data);
}

export async function listAdjustmentRequests(status) {
  const query = status ? { status } : {};
  return queryAll('adjustment_requests', query, { orderBy: [['created_at', 'desc']] });
}

export async function getAdjustmentRequestById(id) {
  return getById('adjustment_requests', id);
}

export async function updateAdjustmentRequest(id, data) {
  return updateDocument('adjustment_requests', id, data);
}

export async function getAdmin() {
  return getById('admins', ADMIN_DOC_ID);
}

export async function getAdminByToken(token) {
  const admin = await getAdmin();
  return admin && admin.token === token ? admin : null;
}

export async function createDefaultAdminIfNotExists(passwordHash, now) {
  const existing = await getAdmin();
  if (existing) return { created: false, admin: existing };

  const admin = await setDocument('admins', ADMIN_DOC_ID, {
    password_hash: passwordHash,
    token: null,
    created_at: now,
    updated_at: now,
  });

  return { created: true, admin };
}

export async function updateAdminPassword(passwordHash, now) {
  const admin = await getAdmin();
  if (!admin) return null;

  return updateDocument('admins', ADMIN_DOC_ID, {
    password_hash: passwordHash,
    token: null,
    updated_at: now,
  });
}

export async function updateAdminToken(token, now) {
  const admin = await getAdmin();
  if (!admin) return null;

  return updateDocument('admins', ADMIN_DOC_ID, {
    token,
    updated_at: now,
  });
}

export default {
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
