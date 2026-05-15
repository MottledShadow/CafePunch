import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import store from './db/cloudbaseStore.js';

const crypto = webcrypto;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

if (!process.env.CLOUDBASE_ENV_ID) {
  console.warn('CLOUDBASE_ENV_ID is not configured. CloudBase SDK will use its default environment resolution.');
}

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/api', handleApiRequest);

app.listen(PORT, () => {
  console.log(`Cafe check-in server listening on port ${PORT}`);
});

async function handleApiRequest(req, res) {
  const url = new URL(req.originalUrl || req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    // ── Setup (SETUP_SECRET required) ──
    if (path === '/api/setup') {
      const envSecret = process.env.SETUP_SECRET;
      if (!envSecret) {
        return json(res, { ok: false, error: 'SETUP_SECRET not configured' }, 500);
      }
      const secret = (url.searchParams.get('secret') || req.headers['x-setup-secret'] || '').trim();
      if (secret !== envSecret) {
        return json(res, { ok: false, error: 'Forbidden' }, 403);
      }
      return json(res, await handleSetup());
    }

    // ── Public routes ──
    if (method === 'GET' && path === '/api/members') {
      return json(res, await handleMembers());
    }
    if (method === 'GET' && path === '/api/records/today') {
      return json(res, await handleTodayRecord(url));
    }
    if (method === 'POST' && path === '/api/checkin') {
      return json(res, await handleCheckin(req));
    }
    if (method === 'POST' && path === '/api/checkout') {
      return json(res, await handleCheckout(req));
    }
    if (method === 'POST' && path === '/api/adjustment-requests') {
      return json(res, await handleSubmitAdjustment(req));
    }
    if (method === 'POST' && path === '/api/admin/login') {
      return json(res, await handleAdminLogin(req));
    }

    // ── Protected routes ──
    const ok = await authenticate(req);
    if (!ok) {
      return json(res, { ok: false, error: '需要管理员权限' }, 401);
    }

    if (method === 'GET' && path === '/api/admin/members') {
      return json(res, await handleAdminMembers());
    }
    if (method === 'POST' && path === '/api/admin/members') {
      return json(res, await handleAdminAddMember(req));
    }
    if (method === 'PUT' && path === '/api/admin/members') {
      return json(res, await handleAdminEditMember(req));
    }
    if (method === 'POST' && path === '/api/admin/members/deactivate') {
      return json(res, await handleAdminDeactivateMember(req));
    }
    if (method === 'GET' && path === '/api/admin/adjustment-requests') {
      return json(res, await handleAdminAdjustments(url));
    }
    if (method === 'POST' && path === '/api/admin/adjustment-requests/review') {
      return json(res, await handleAdminReviewAdjustment(req));
    }
    if (method === 'GET' && path === '/api/admin/records') {
      return json(res, await handleAdminRecords());
    }
    if (method === 'GET' && path === '/api/admin/stats/monthly') {
      return json(res, await handleAdminStatsMonthly(url));
    }
    if (method === 'GET' && path === '/api/admin/export/monthly.xlsx') {
      return handleAdminExportMonthly(url, res);
    }
    if (method === 'PUT' && path === '/api/admin/password') {
      return json(res, await handleAdminPassword(req));
    }

    return json(res, { ok: false, error: 'Not Found' }, 404);
  } catch (e) {
    return json(res, { ok: false, error: e.message }, 500);
  }
}

// ─────────────────────────────────────
//  UTC+8 time helpers
// ─────────────────────────────────────
function beijingNow() {
  // Returns Date at UTC+8
  const d = new Date();
  return new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600000);
}
function beijingDate() {
  const d = beijingNow();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function getCurrentMonthUTC8() {
  const d = beijingNow();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
function beijingTime() {
  const d = beijingNow();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${sec}`;
}

// ─────────────────────────────────────
//  Helpers
// ─────────────────────────────────────
function json(res, data, status = 200) {
  return res.status(status).json(data);
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Safe datetime parsing ──
function parseBusinessDateTime(str) {
  if (!str) return null;
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

function minutesBetween(t1, t2) {
  const d1 = parseBusinessDateTime(t1);
  const d2 = parseBusinessDateTime(t2);
  if (d1 === null || d2 === null) return 0;
  return (d2 - d1) / 60000;
}

// ─────────────────────────────────────
//  Auth
// ─────────────────────────────────────
async function authenticate(req) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  const admin = await store.getAdminByToken(token);
  return Boolean(admin);
}

// ─────────────────────────────────────
//  GET|POST /api/setup — idempotent
// ─────────────────────────────────────
async function handleSetup() {
  const collections = await store.ensureCollections();
  const admin = await store.createDefaultAdminIfNotExists(
    '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
    beijingTime(),
  );

  return {
    ok: true,
    message: 'CloudBase 数据库已就绪',
    collections,
    default_admin_created: admin.created,
  };
}

// ─────────────────────────────────────
//  GET /api/members — active only
// ─────────────────────────────────────
async function handleMembers() {
  const members = await store.listActiveMembers();
  return { ok: true, members };
}

// ─────────────────────────────────────
//  GET /api/records/today?member_id=xxx
// ─────────────────────────────────────
async function handleTodayRecord(url) {
  const memberId = (url.searchParams.get('member_id') || '').trim();
  if (!memberId) return { ok: false, code: 400, error: '缺少 member_id 参数' };

  const today = beijingDate();
  const record = await store.getTodayRecord(memberId, today);
  return { ok: true, record };
}

// ─────────────────────────────────────
//  POST /api/checkin
// ─────────────────────────────────────
async function handleCheckin(req) {
  const body = req.body || {};
  const memberId = String(body.member_id || '').trim();
  const deviceId = (body.device_id || '').trim();
  if (!memberId) return { ok: false, code: 400, error: '缺少 member_id' };
  if (!deviceId) return { ok: false, code: 400, error: '缺少 device_id' };

  // Verify member is active
  const member = await store.getActiveMemberById(memberId);
  if (!member) {
    return { ok: false, code: 400, error: '无效的值班人员' };
  }
  const memberName = member.name;

  const today = beijingDate();
  const now = beijingTime();
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  // Check existing record today
  const rec = await store.getTodayRecord(memberId, today);

  if (rec && !rec.check_out) {
    return { ok: false, code: 409, error: '今天已签到，尚未签退' };
  }
  if (rec && rec.check_out) {
    return { ok: false, code: 409, error: '今天已完成签到签退' };
  }

  await store.createCheckinRecord({
    member_id: memberId,
    member_name: memberName,
    name: memberName,
    date: today,
    check_in: now,
    check_out: null,
    device_id: deviceId,
    source_ip: ip,
    created_at: now,
    updated_at: now,
  });

  return { ok: true, member_id: memberId, member_name: memberName, date: today, check_in: now };
}

// ─────────────────────────────────────
//  POST /api/checkout
// ─────────────────────────────────────
async function handleCheckout(req) {
  const body = req.body || {};
  const memberId = String(body.member_id || '').trim();
  const deviceId = (body.device_id || '').trim();
  if (!memberId) return { ok: false, code: 400, error: '缺少 member_id' };
  if (!deviceId) return { ok: false, code: 400, error: '缺少 device_id' };

  // Verify member is active
  const member = await store.getActiveMemberById(memberId);
  if (!member) {
    return { ok: false, code: 400, error: '无效的值班人员' };
  }

  const today = beijingDate();
  const now = beijingTime();

  const rec = await store.getTodayRecord(memberId, today);

  if (!rec) return { ok: false, code: 404, error: '今天还没有签到记录' };
  if (rec.check_out) return { ok: false, code: 409, error: '今天已经签退过了' };

  // Update check_out, keep existing device_id (don't overwrite)
  await store.checkoutRecord(rec._id, now, { updated_at: now });

  return { ok: true, member_id: memberId, date: today, check_in: rec.check_in, check_out: now };
}

// ─────────────────────────────────────
//  POST /api/adjustment-requests
// ─────────────────────────────────────
async function handleSubmitAdjustment(req) {
  const body = req.body || {};
  const memberId = String(body.member_id || '').trim();
  const date = (body.date || '').trim();
  const requestType = (body.request_type || '').trim();
  const checkIn = (body.requested_check_in || '').trim();
  const checkOut = (body.requested_check_out || '').trim();
  const reason = (body.reason || '').trim();
  const deviceId = (body.device_id || '').trim();

  if (!memberId) return { ok: false, code: 400, error: '缺少 member_id' };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, code: 400, error: '无效的日期格式' };
  if (!['checkin', 'checkout', 'both'].includes(requestType)) return { ok: false, code: 400, error: '无效的补签类型' };
  if (!reason) return { ok: false, code: 400, error: '请填写申请原因' };
  if (!deviceId) return { ok: false, code: 400, error: '缺少 device_id' };

  // Verify member is active
  const member = await store.getActiveMemberById(memberId);
  if (!member) return { ok: false, code: 400, error: '无效的值班人员' };

  const memberName = member.name;

  // Validate time fields
  const timeRe = /^\d{2}:\d{2}$/;
  if (requestType === 'checkin' || requestType === 'both') {
    if (!checkIn || !timeRe.test(checkIn)) return { ok: false, code: 400, error: '请填写有效的补签到时间（HH:mm）' };
  }
  if (requestType === 'checkout' || requestType === 'both') {
    if (!checkOut || !timeRe.test(checkOut)) return { ok: false, code: 400, error: '请填写有效的补签退时间（HH:mm）' };
  }

  const now = beijingTime();
  const fullCheckIn = checkIn ? `${date} ${checkIn}:00` : null;
  const fullCheckOut = checkOut ? `${date} ${checkOut}:00` : null;

  await store.createAdjustmentRequest({
    member_id: memberId,
    member_name: memberName,
    date,
    request_type: requestType,
    requested_check_in: fullCheckIn,
    requested_check_out: fullCheckOut,
    reason,
    status: 'pending',
    admin_note: null,
    device_id: deviceId,
    created_at: now,
    reviewed_at: null,
  });

  return { ok: true, message: '补签申请已提交，等待管理员审核' };
}

// ─────────────────────────────────────
//  Admin: GET /api/admin/members (all)
// ─────────────────────────────────────
async function handleAdminMembers() {
  const members = await store.listAllMembers();
  return { ok: true, members };
}

// ─────────────────────────────────────
//  Admin: POST /api/admin/members
// ─────────────────────────────────────
async function handleAdminAddMember(req) {
  const body = req.body || {};
  const name = (body.name || '').trim();
  if (!name) return { ok: false, code: 400, error: '缺少值班人员姓名' };

  // Check duplicate (active only)
  const dup = await store.findActiveMemberByName(name);
  if (dup) return { ok: false, code: 409, error: '该值班人员已存在' };

  const now = beijingTime();
  const member = await store.createMember(name, now);

  return { ok: true, member };
}

// ─────────────────────────────────────
//  Admin: PUT /api/admin/members
// ─────────────────────────────────────
async function handleAdminEditMember(req) {
  const body = req.body || {};
  const id = String(body.id || '').trim();
  const name = (body.name || '').trim();
  if (!id) return { ok: false, code: 400, error: '缺少 member_id' };
  if (!name) return { ok: false, code: 400, error: '缺少姓名' };

  // Prevent rename to another active member's name
  const dup = await store.findActiveMemberByName(name);
  if (dup && dup._id !== id) return { ok: false, code: 409, error: '该姓名已被其他值班人员使用' };

  const now = beijingTime();
  const member = await store.updateMember(id, { name, updated_at: now });
  if (!member) return { ok: false, code: 404, error: '值班人员不存在' };

  return { ok: true, member };
}

// ─────────────────────────────────────
//  Admin: POST /api/admin/members/deactivate
// ─────────────────────────────────────
async function handleAdminDeactivateMember(req) {
  const body = req.body || {};
  const id = String(body.id || '').trim();
  if (!id) return { ok: false, code: 400, error: '缺少 member_id' };

  const now = beijingTime();
  const member = await store.deactivateMember(id, now);
  if (!member) return { ok: false, code: 404, error: '值班人员不存在' };

  return { ok: true, member };
}

// ─────────────────────────────────────
//  Admin: GET /api/admin/records
// ─────────────────────────────────────
async function handleAdminRecords() {
  const records = await store.listAdminRecords();
  return { ok: true, records };
}

// ─────────────────────────────────────
//  Admin: GET /api/admin/adjustment-requests?status=
// ─────────────────────────────────────
async function handleAdminAdjustments(url) {
  const status = url.searchParams.get('status') || '';
  const filter = status && ['pending', 'approved', 'rejected'].includes(status) ? status : '';
  const requests = await store.listAdjustmentRequests(filter);
  return { ok: true, requests };
}

// ─────────────────────────────────────
//  Admin: POST /api/admin/adjustment-requests/review
// ─────────────────────────────────────
async function handleAdminReviewAdjustment(req) {
  const body = req.body || {};
  const id = String(body.id || '').trim();
  const action = (body.action || '').trim();
  const note = (body.admin_note || '').trim();

  if (!id) return { ok: false, code: 400, error: '缺少申请 ID' };
  if (!['approve', 'reject'].includes(action)) return { ok: false, code: 400, error: '无效的审核动作' };

  // Fetch the request
  const adj = await store.getAdjustmentRequestById(id);
  if (!adj) return { ok: false, code: 404, error: '申请不存在' };
  if (adj.status !== 'pending') return { ok: false, code: 409, error: '该申请已处理' };

  const now = beijingTime();

  if (action === 'approve') {
    // Find or create a record for this member + date
    let rec = await store.findRecordByMemberAndDate(adj.member_id, adj.date);

    if (!rec) {
      // No record exists — create one
      rec = await store.createRecord({
        member_id: adj.member_id,
        member_name: adj.member_name,
        name: adj.member_name,
        date: adj.date,
        check_in: null,
        check_out: null,
        device_id: adj.device_id,
        source_ip: 'adjustment',
        created_at: now,
        updated_at: now,
      });
    }

    // Don't silently overwrite existing values
    if ((adj.request_type === 'checkin' || adj.request_type === 'both') && rec.check_in) {
      return { ok: false, code: 409, error: '该记录已有签到时间，请先人工确认' };
    }
    if ((adj.request_type === 'checkout' || adj.request_type === 'both') && rec.check_out) {
      return { ok: false, code: 409, error: '该记录已有签退时间，请先人工确认' };
    }

    // Apply check_in / check_out
    const updates = { updated_at: now };
    if (adj.request_type === 'checkin' || adj.request_type === 'both') {
      updates.check_in = adj.requested_check_in;
    }
    if (adj.request_type === 'checkout' || adj.request_type === 'both') {
      updates.check_out = adj.requested_check_out;
    }
    await store.updateRecord(rec._id, updates);

    await store.updateAdjustmentRequest(id, {
      status: 'approved',
      admin_note: note || null,
      reviewed_at: now,
    });
  } else {
    // Reject
    await store.updateAdjustmentRequest(id, {
      status: 'rejected',
      admin_note: note || null,
      reviewed_at: now,
    });
  }

  return { ok: true, message: action === 'approve' ? '已通过，签到记录已更新' : '已拒绝' };
}

// ─────────────────────────────────────
//  Admin: GET /api/admin/export/monthly.xlsx?month=YYYY-MM
// ─────────────────────────────────────
// ─────────────────────────────────────
//  Shared: compute monthly stats (used by both JSON and xlsx endpoints)
// ─────────────────────────────────────
async function getMonthlyStats(month) {
  const activeMembers = await store.listActiveMembers();
  const rows = await store.listRecordsByMonth(month);

  const memberMap = {};
  for (const m of activeMembers) {
    memberMap[m._id] = {
      member_id: m._id, member_name: m.name, status: m.status,
      attendance_count: 0, completed_count: 0, incomplete_count: 0, abnormal_count: 0, total_minutes: 0
    };
  }

  const records = rows.map(r => {
    const pin = parseBusinessDateTime(r.check_in);
    const pout = parseBusinessDateTime(r.check_out);
    let st = 'incomplete', mins = 0;
    if (pin !== null && pout !== null) {
      const diff = (pout - pin) / 60000;
      if (diff < 0) { st = 'abnormal'; }
      else { st = 'completed'; mins = diff; }
    }
    return { ...r, status: st, minutes: mins, hours: mins > 0 ? +(mins / 60).toFixed(2) : 0 };
  });

  for (const rec of records) {
    const mid = rec.member_id || 0;
    if (!memberMap[mid]) {
      memberMap[mid] = {
        member_id: mid, member_name: rec.member_name || '—', status: 'inactive',
        attendance_count: 0, completed_count: 0, incomplete_count: 0, abnormal_count: 0, total_minutes: 0
      };
    }
    const s = memberMap[mid];
    s.attendance_count++;
    if (rec.status === 'completed') { s.completed_count++; s.total_minutes += rec.minutes; }
    else if (rec.status === 'abnormal') { s.abnormal_count++; }
    else { s.incomplete_count++; }
  }

  const summary = Object.values(memberMap)
    .map(s => ({ ...s, total_hours: +(s.total_minutes / 60).toFixed(2) }))
    .sort((a, b) => a.member_name.localeCompare(b.member_name));

  return { month, summary, records };
}

// ─────────────────────────────────────
//  Admin: GET /api/admin/export/monthly.xlsx?month=YYYY-MM
// ─────────────────────────────────────
async function handleAdminExportMonthly(url, res) {
  let month = (url.searchParams.get('month') || '').trim();
  if (!month) month = getCurrentMonthUTC8();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return json(res, { ok: false, error: '无效的月份格式' }, 400);
  }

  const { summary, records } = await getMonthlyStats(month);

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const summaryRows = summary.map(s => ({
    '月份': month,
    '值班人员': s.member_name,
    '状态': s.status === 'active' ? '在岗' : '已停用',
    '出勤次数': s.attendance_count,
    '完整记录数': s.completed_count,
    '未完成记录数': s.incomplete_count,
    '异常记录数': s.abnormal_count,
    '总分钟数': s.total_minutes,
    '总工时': s.total_hours,
  }));
  const ws1 = XLSX.utils.json_to_sheet(summaryRows);
  ws1['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws1, '月度汇总');

  const detailRows = records.map(r => ({
    '日期': r.date,
    '值班人员': r.member_name || r.name || '—',
    '签到时间': r.check_in ? r.check_in.slice(11, 19) : '',
    '签退时间': r.check_out ? r.check_out.slice(11, 19) : '',
    '本次分钟数': r.minutes,
    '本次工时': r.hours,
    '状态': r.status === 'completed' ? '完整' : r.status === 'incomplete' ? '未完成' : '时间异常',
    '设备ID后6位': r.device_id ? r.device_id.slice(-6) : '',
    '来源IP': r.source_ip || '',
  }));
  const ws2 = XLSX.utils.json_to_sheet(detailRows);
  ws2['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, '考勤明细');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="cafe-attendance-' + month + '.xlsx"');
  return res.status(200).send(Buffer.from(buf));
}

// ─────────────────────────────────────
//  Admin: GET /api/admin/stats/monthly?month=YYYY-MM
// ─────────────────────────────────────
async function handleAdminStatsMonthly(url) {
  let month = (url.searchParams.get('month') || '').trim();
  if (!month) month = getCurrentMonthUTC8();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, code: 400, error: '无效的月份格式，需要 YYYY-MM' };
  }

  const data = await getMonthlyStats(month);
  return { success: true, ...data };
}
// ─────────────────────────────────────
//  Admin: PUT /api/admin/password
// ─────────────────────────────────────
async function handleAdminPassword(req) {
  const body = req.body || {};
  const oldPw = (body.old || '').trim();
  const newPw = (body.new || '').trim();
  if (!oldPw || !newPw) return { ok: false, code: 400, error: '缺少旧密码或新密码' };
  if (newPw.length < 2) return { ok: false, code: 400, error: '新密码至少2位' };

  const admin = await store.getAdmin();
  if (!admin) return { ok: false, code: 500, error: '管理员账户未初始化，请先调用 /api/setup' };

  const oldHash = await sha256(oldPw);
  if (oldHash !== admin.password_hash) return { ok: false, code: 403, error: '旧密码错误' };

  const newHash = await sha256(newPw);
  await store.updateAdminPassword(newHash, beijingTime());

  return { ok: true, message: '密码已修改，请重新登录' };
}

// ─────────────────────────────────────
//  Admin: POST /api/admin/login
// ─────────────────────────────────────
async function handleAdminLogin(req) {
  const body = req.body || {};
  const password = (body.password || '').trim();
  if (!password) return { ok: false, code: 400, error: '缺少密码' };

  const admin = await store.getAdmin();
  if (!admin) return { ok: false, code: 500, error: '管理员账户未初始化，请先调用 /api/setup' };

  const hash = await sha256(password);
  if (hash !== admin.password_hash) return { ok: false, code: 403, error: '密码错误' };

  const token = makeToken();
  await store.updateAdminToken(token, beijingTime());

  return { ok: true, token };
}
