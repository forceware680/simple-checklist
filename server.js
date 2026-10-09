require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const crypto = require('crypto');
const { isMssqlConfigured, getMssqlPool } = require('./mssql');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Data OPD (static, dari OPDHerman.json) ---
const opds = JSON.parse(fs.readFileSync(path.join(__dirname, 'OPDHerman.json'), 'utf8'));
// salin terurut berdasarkan kode OPD (dipakai untuk tabel statistik + rekonsiliasi + autocomplete)
const opdsByCode = [...opds].sort((a, b) => a.PBSubk.localeCompare(b.PBSubk));
// mapping kode OPD <-> 16-char NoTerima prefix (sumber MSSQL)
const opdToKey = code => String(code || '').replace(/\./g, '');
const keyToOpd = key => { const k = String(key); return `${k.slice(0,6)}.${k.slice(6,11)}.${k.slice(11,16)}`; };

// --- PostgreSQL (koneksi dari .env) ---
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL belum di-set. Salin .env.example jadi .env lalu isi kredensialnya.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const COLS = ['saldo_awal', 'saldo_awal_juli', ...MONTHS, 'sem1', 'sem2'];

// --- Admin auth (token signed stateless; secret dari .env) ---
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 jam
function adminSign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function adminVerify(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!obj.exp || obj.exp < Date.now()) return null;
    return obj;
  } catch { return null; }
}
function getAdminToken(req) {
  const c = req.headers.cookie || '';
  const m = c.match(/(?:^|;\s*)admin_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
function requireAdmin(req, res, next) {
  const obj = adminVerify(getAdminToken(req));
  if (!obj) return res.status(401).json({ error: 'Belum login admin' });
  req.admin = obj;
  next();
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      opd_code  TEXT PRIMARY KEY,
      saldo_awal NUMERIC(12,2) NOT NULL DEFAULT 0,
      saldo_awal_juli NUMERIC(12,2) NOT NULL DEFAULT 0,
      ${MONTHS.map(m => `${m} NUMERIC(12,2) NOT NULL DEFAULT 0`).join(',\n      ')},
      sem1 NUMERIC(12,2) NOT NULL DEFAULT 0,
      sem2 NUMERIC(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ
    )
  `);
  // migrasi: tambahkan kolom ke tabel lama, lalu konversi semua kolom angka ke NUMERIC(12,2) agar dukung desimal
  await pool.query('ALTER TABLE entries ADD COLUMN IF NOT EXISTS saldo_awal NUMERIC(12,2) NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE entries ADD COLUMN IF NOT EXISTS saldo_awal_juli NUMERIC(12,2) NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE entries ADD COLUMN IF NOT EXISTS opname_simaset NUMERIC(12,2) NOT NULL DEFAULT 0');
  for (const c of COLS) {
    await pool.query(`ALTER TABLE entries ALTER COLUMN ${c} TYPE NUMERIC(12,2)`);
  }
  // tabel temp: hasil tarik dari sumber (MSSQL) — dipakai buat rekonsiliasi
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tarik_temp (
      opd_code TEXT PRIMARY KEY,
      saldo_awal NUMERIC(12,2) NOT NULL DEFAULT 0,
      saldo_src TEXT,
      ${MONTHS.map(m => `${m} NUMERIC(12,2) NOT NULL DEFAULT 0`).join(',\n      ')},
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      pulled_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/opds', (req, res) => res.json(opdsByCode));

// Isian satu OPD (total penerimaan per bulan + total pengeluaran per semester)
app.get('/api/opds/:code', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM entries WHERE opd_code = $1', [req.params.code]);
    res.json(rows[0] || null);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal memuat data' });
  }
});

app.put('/api/opds/:code', async (req, res) => {
  const code = req.params.code;
  if (!opds.some(o => o.PBSubk === code)) return res.status(404).json({ error: 'OPD tidak ditemukan' });
  const num = v => { const n = Math.round((Number(v) + Number.EPSILON) * 100) / 100; return isFinite(n) ? Math.max(0, n) : 0; };
  const vals = {};
  for (const c of COLS) vals[c] = num(req.body[c]);
  try {
    const values = COLS.map(c => vals[c]);
    await pool.query(
      `INSERT INTO entries (opd_code, ${COLS.join(', ')}, updated_at)
       VALUES ($1, ${COLS.map((_, i) => '$' + (i + 2)).join(', ')}, $${COLS.length + 2})
       ON CONFLICT (opd_code) DO UPDATE SET
         ${COLS.map(c => `${c} = EXCLUDED.${c}`).join(', ')},
         updated_at = EXCLUDED.updated_at`,
      [code, ...values, new Date().toISOString()]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal menyimpan' });
  }
});

// Rekap seluruh OPD (statistik) — per bulan + per semester + stock opname
app.get('/api/statistik', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM entries');
    const map = {};
    rows.forEach(r => { map[r.opd_code] = r; });
    const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const out = opdsByCode.map(o => {
      const r = map[o.PBSubk];
      const saldo_awal = round2((r ? Number(r.saldo_awal) : 0) || 0);
      const saldo_juli = round2((r ? Number(r.saldo_awal_juli) : 0) || 0);
      const months = MONTHS.map(m => round2((r ? Number(r[m]) : 0) || 0));
      const total_in = round2(months.reduce((s, v) => s + v, 0));            // Jan-Des
      const in_s1 = round2(months.slice(0, 6).reduce((s, v) => s + v, 0));   // Jan-Jun
      const in_s2 = round2(months.slice(6).reduce((s, v) => s + v, 0));      // Jul-Des
      const total_s1_dgn = round2(saldo_awal + in_s1);                       // saldo awal + Total Penerimaan S1
      const total_s2_dgn = round2(saldo_juli + in_s2);                       // saldo awal Juli + Total Penerimaan S2
      const sem1 = round2((r ? Number(r.sem1) : 0) || 0);
      const sem2 = round2((r ? Number(r.sem2) : 0) || 0);
      const total_out = round2(sem1 + sem2);
      const total_dgn_saldo = round2(saldo_awal + total_in);                 // total penerimaan + saldo awal
      const stock1 = round2(saldo_awal + in_s1 - sem1);                      // saldo awal + Jan-Jun - pengeluaran S1
      const stock2 = round2(saldo_juli + in_s2 - sem2);                      // saldo awal Juli + Jul-Des - pengeluaran S2
      const stock_year = round2(saldo_awal + total_in - total_out);          // saldo awal + Jan-Des - (S1+S2)
      const opname = round2((r ? Number(r.opname_simaset) : 0) || 0);
      const selisih = round2(opname - stock_year);                           // Opname Simaset - Stock Opname Tahunan
      return {
        code: o.PBSubk,
        name: o.KetPBSubk,
        filled: (total_in + total_out) > 0,
        saldo_awal,
        saldo_juli,
        months,
        total_in,
        total_dgn_saldo,
        in_s1,
        in_s2,
        total_s1_dgn,
        total_s2_dgn,
        sem1,
        sem2,
        total_out,
        stock1,
        stock2,
        stock_year,
        opname_simaset: opname,
        selisih
      };
    });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal memuat rekap' });
  }
});

// --- Admin: rekonsiliasi SIMASET (akses via #/admin, tidak tampil di menu) ---
app.post('/api/admin/login', (req, res) => {
  const u = (req.body && req.body.username) || '';
  const p = (req.body && req.body.password) || '';
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) return res.status(500).json({ error: 'Admin belum dikonfigurasi' });
  if (u !== process.env.ADMIN_USER || p !== process.env.ADMIN_PASS) return res.status(401).json({ error: 'Username atau password salah' });
  const token = adminSign({ user: process.env.ADMIN_USER, exp: Date.now() + TOKEN_TTL });
  res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(TOKEN_TTL / 1000)}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => {
  const obj = adminVerify(getAdminToken(req));
  res.json({ authenticated: !!obj, user: obj ? obj.user : null });
});
app.get('/api/admin/rekonsiliasi', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM entries');
    const map = {}; rows.forEach(r => { map[r.opd_code] = r; });
    const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const out = opdsByCode.map(o => {
      const r = map[o.PBSubk];
      const saldo_awal = r ? Number(r.saldo_awal) || 0 : 0;
      const total_in = r ? MONTHS.reduce((s, m) => s + (Number(r[m]) || 0), 0) : 0;
      const total_out = r ? (Number(r.sem1) || 0) + (Number(r.sem2) || 0) : 0;
      const stock_year = round2(saldo_awal + total_in - total_out);
      const opname = r ? round2(Number(r.opname_simaset) || 0) : 0;
      return { code: o.PBSubk, name: o.KetPBSubk, stock_year, opname_simaset: opname, selisih: round2(opname - stock_year) };
    });
    res.json(out);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal memuat' }); }
});
app.put('/api/admin/opname/:code', requireAdmin, async (req, res) => {
  const code = req.params.code;
  if (!opds.some(o => o.PBSubk === code)) return res.status(400).json({ error: 'OPD tidak dikenal' });
  const num = v => { const n = Math.round((Number(v) + Number.EPSILON) * 100) / 100; return isFinite(n) ? Math.max(0, n) : 0; };
  const val = num(req.body && req.body.opname_simaset);
  try {
    await pool.query(
      `INSERT INTO entries (opd_code, opname_simaset, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (opd_code) DO UPDATE SET opname_simaset = EXCLUDED.opname_simaset, updated_at = EXCLUDED.updated_at`,
      [code, val, new Date().toISOString()]
    );
    res.json({ ok: true, opname_simaset: val });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal menyimpan' }); }
});

// --- Tarik data dari sumber MSSQL (read-only). Data item-level → admin-only ---
function mssqlGuard(req, res) { if (!isMssqlConfigured()) { res.status(503).json({ error: 'MSSQL sumber belum dikonfigurasi' }); return false; } return true; }

async function tarikDetail(res, { opd, periodeAwal, periodeAkhir, detailTable, headerTable, asalUsul, noTerimaMode }) {
  if (!opd || !opds.some(o => o.PBSubk === opd)) return res.status(400).json({ error: 'OPD tidak dikenal' });
  const noTerima = opdToKey(opd);
  const noTerimaFilter = noTerimaMode === 'contains' ? "d.NoTerima LIKE '%' + @noTerima + '%'" : "d.NoTerima LIKE @noTerima + '%'";
  const asalUsulClause = asalUsul ? 'AND h.AsalUsul = ' + asalUsul : '';
  const q = `
    WITH FilteredData AS (
      SELECT d.NoTerima, d.ObjekPersediaan, op.Keterangan AS NamaBarang, d.Satuan, d.MerkType,
             d.Jumlah, d.Harga, (d.Jumlah*d.Harga) AS TotalHarga, h.TglBAST AS BAST, h.NoBAST,
             d.Kadaluwarsa, d.Keterangan, h.TglInput AS TglInput, LEFT(d.NoTerima,16) AS PBSubkNoDot
      FROM ${detailTable} d WITH (NOLOCK)
      JOIN ${headerTable} h WITH (NOLOCK) ON d.NoTerima = h.NoTerima
      JOIN AsetMaster90.dbo.ObjekpersediaanPLU op WITH (NOLOCK) ON d.ObjekPersediaan = op.IDPLU
      WHERE ${noTerimaFilter} ${asalUsulClause}
        AND h.TglBAST >= CONVERT(DATETIME,@periodeAwal,120)
        AND h.TglBAST <= CONVERT(DATETIME,@periodeAkhir,120)
    )
    SELECT NoTerima, ObjekPersediaan, NamaBarang, Satuan, MerkType, Jumlah, Harga, TotalHarga, BAST, NoBAST, Kadaluwarsa, Keterangan, TglInput
    FROM FilteredData ORDER BY BAST ASC`;
  try {
    const conn = await getMssqlPool();
    const r = await conn.request().input('noTerima', noTerima).input('periodeAwal', periodeAwal).input('periodeAkhir', periodeAkhir).query(q);
    res.json({ opd, noTerima, periode_awal: periodeAwal, periode_akhir: periodeAkhir, count: r.recordset.length, data: r.recordset });
  } catch (e) { console.error('Tarik detail error:', e); res.status(500).json({ error: 'Gagal menarik data dari sumber' }); }
}

app.get('/api/tarik/saldo-awal', requireAdmin, (req, res) => {
  if (!mssqlGuard(req, res)) return;
  tarikDetail(res, { opd: req.query.opd, periodeAwal: req.query.periode_awal || '2026-01-01', periodeAkhir: req.query.periode_akhir || '2026-12-31 23:59:59', detailTable: 'AsetPersediaan90.dbo.PenerimaanDetDPANon', headerTable: 'AsetPersediaan90.dbo.PenerimaanDPANon', asalUsul: "'AWAL'", noTerimaMode: 'prefix' });
});
app.get('/api/tarik/saldo-berjalan', requireAdmin, (req, res) => {
  if (!mssqlGuard(req, res)) return;
  tarikDetail(res, { opd: req.query.opd, periodeAwal: req.query.periode_awal || '2026-01-01', periodeAkhir: req.query.periode_akhir || '2026-12-31 23:59:59', detailTable: 'AsetPersediaan90.dbo.PenerimaanDetDPA', headerTable: 'AsetPersediaan90.dbo.PenerimaanDPA', asalUsul: null, noTerimaMode: 'contains' });
});

// Rekap bulanan (semua OPD) — Tahun Anggaran 2026
// saldo_awal = query 'saldo awal'; jika 0 → fallback 'saldo awal th lalu' (tutupbuku)
// Bangun SQL "saldo th lalu" (tutupbuku FIFO → harga) untuk daftar OPD (keys NoTerima 16-char)
function buildSqlThLalu(inList) {
  return `
    ;WITH SO AS (
      SELECT LEFT(a.NoTB,16) AS opd, b.FiFo, (b.Jumlah - b.Opname) AS JmlAkhir
      FROM AsetPersediaan90.dbo.tutupbuku a WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.tutupbukudet b WITH (NOLOCK) ON a.NoTB = b.NoTB
      WHERE a.Awal >= CONVERT(DATETIME,@start,120) AND a.Awal < CONVERT(DATETIME,@end,120)
        AND LEFT(a.NoTB,16) IN (${inList})
    ),
    PDraw AS (
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,p.TglBAST) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,p.TglBast) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPA d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
      UNION ALL
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,p.TglBAST) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,p.TglBast) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPANon d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPANon p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
      UNION ALL
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,COALESCE(p.TglInput,p.TglBAST)) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,COALESCE(p.TglInput,p.TglBAST)) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPA d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
      UNION ALL
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,COALESCE(p.TglInput,p.TglBAST)) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,COALESCE(p.TglInput,p.TglBAST)) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPANon d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPANon p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
    ),
    PD AS (SELECT FIFO, MAX(Harga) AS Harga FROM PDraw GROUP BY FIFO)
    SELECT s.opd, SUM(s.JmlAkhir * p.Harga) AS total
    FROM SO s JOIN PD p ON s.FiFo = p.FIFO
    GROUP BY s.opd`;
}

// Tarik rekap SEMUA OPD dari MSSQL (batched, 3 query). Return [{code,name,saldo_awal,saldo_src,months,total}]
async function pullAllFromMssql() {
  const year = 2026;
  const start = year + '-01-01', end = (year + 1) + '-01-01';
  const inList = opdsByCode.map(o => `'${opdToKey(o.PBSubk)}'`).join(',');
  const sqlThLalu = buildSqlThLalu(inList);
  const conn = await getMssqlPool();
  const [berjalan, awal, thLalu] = await Promise.all([
    conn.request().input('start', start).input('end', end)
      .query(`SELECT LEFT(pd.NoTerima,16) AS opd, MONTH(p.TglBAST) AS m, SUM(pd.Jumlah*pd.Harga) AS total
               FROM AsetPersediaan90.dbo.PenerimaanDetDPA pd WITH (NOLOCK)
               JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON pd.NoTerima = p.NoTerima
               WHERE p.TglBAST >= CONVERT(DATETIME,@start,120) AND p.TglBAST < CONVERT(DATETIME,@end,120)
               AND LEFT(pd.NoTerima,16) IN (${inList})
               GROUP BY LEFT(pd.NoTerima,16), MONTH(p.TglBAST)`),
    conn.request().input('start', start).input('end', end)
      .query(`SELECT LEFT(d.NoTerima,16) AS opd, SUM(d.Jumlah*d.Harga) AS total
               FROM AsetPersediaan90.dbo.PenerimaanDetDPANon d WITH (NOLOCK)
               JOIN AsetPersediaan90.dbo.PenerimaanDPANon h WITH (NOLOCK) ON d.NoTerima = h.NoTerima
               WHERE h.AsalUsul='AWAL' AND h.TglBast >= CONVERT(DATETIME,@start,120) AND h.TglBast < CONVERT(DATETIME,@end,120)
               AND LEFT(d.NoTerima,16) IN (${inList})
               GROUP BY LEFT(d.NoTerima,16)`),
    conn.request().input('start', start).input('end', end).query(sqlThLalu)
  ]);
  const map = {};
  const ensure = k => (map[k] = map[k] || { saldo_awal: 0, saldo_src: null, months: Array(12).fill(0) });
  awal.recordset.forEach(r => { const e = ensure(r.opd); const v = Number(r.total) || 0; if (v > 0) { e.saldo_awal = v; e.saldo_src = 'awal'; } });
  thLalu.recordset.forEach(r => { const e = ensure(r.opd); const v = Number(r.total) || 0; if (v > 0 && e.saldo_awal <= 0) { e.saldo_awal = v; e.saldo_src = 'th_lalu'; } });
  berjalan.recordset.forEach(r => { const i = Number(r.m) - 1; if (i >= 0 && i < 12) ensure(r.opd).months[i] += Number(r.total) || 0; });
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  return opdsByCode.map(o => {
    const e = map[opdToKey(o.PBSubk)] || { saldo_awal: 0, saldo_src: null, months: Array(12).fill(0) };
    const months = e.months.map(round2);
    return { code: o.PBSubk, name: o.KetPBSubk, saldo_awal: round2(e.saldo_awal), saldo_src: e.saldo_src, months, total: round2(months.reduce((s, v) => s + v, 0)) };
  });
}

// Tarik rekap 1 OPD dari MSSQL (+ rincian item). Return {code,name,saldo_awal,saldo_src,months,total,items}
async function pullOpdFromMssql(code) {
  const year = 2026, start = year + '-01-01', end = (year + 1) + '-01-01';
  const key = opdToKey(code);
  const inList = `'${key}'`;
  const sqlThLalu = buildSqlThLalu(inList);
  const conn = await getMssqlPool();
  const [berjalan, awal, thLalu, items] = await Promise.all([
    conn.request().input('opd', key).input('start', start).input('end', end)
      .query(`SELECT MONTH(p.TglBAST) AS m, SUM(pd.Jumlah*pd.Harga) AS total
              FROM AsetPersediaan90.dbo.PenerimaanDetDPA pd WITH (NOLOCK)
              JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON pd.NoTerima = p.NoTerima
              WHERE LEFT(pd.NoTerima,16) = @opd
                AND p.TglBAST >= CONVERT(DATETIME,@start,120) AND p.TglBAST < CONVERT(DATETIME,@end,120)
              GROUP BY MONTH(p.TglBAST)`),
    conn.request().input('opd', key).input('start', start).input('end', end)
      .query(`SELECT SUM(d.Jumlah*d.Harga) AS total
              FROM AsetPersediaan90.dbo.PenerimaanDetDPANon d WITH (NOLOCK)
              JOIN AsetPersediaan90.dbo.PenerimaanDPANon h WITH (NOLOCK) ON d.NoTerima = h.NoTerima
              WHERE h.AsalUsul='AWAL' AND h.TglBast >= CONVERT(DATETIME,@start,120) AND h.TglBast < CONVERT(DATETIME,@end,120)
              AND LEFT(d.NoTerima,16) = @opd`),
    conn.request().input('opd', key).input('start', start).input('end', end).query(sqlThLalu),
    conn.request().input('opd', key).input('start', start).input('end', end)
      .query(`SELECT d.NoTerima, op.Keterangan AS NamaBarang, d.Satuan, d.MerkType, d.Jumlah, d.Harga,
                     (d.Jumlah*d.Harga) AS TotalHarga, p.TglBAST AS BAST, p.NoBAST
              FROM AsetPersediaan90.dbo.PenerimaanDetDPA d WITH (NOLOCK)
              JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON d.NoTerima = p.NoTerima
              JOIN AsetMaster90.dbo.ObjekpersediaanPLU op WITH (NOLOCK) ON d.ObjekPersediaan = op.IDPLU
              WHERE LEFT(d.NoTerima,16) = @opd
                AND p.TglBAST >= CONVERT(DATETIME,@start,120) AND p.TglBAST < CONVERT(DATETIME,@end,120)
              ORDER BY p.TglBAST ASC`)
  ]);
  const months = Array(12).fill(0);
  berjalan.recordset.forEach(r => { const i = Number(r.m) - 1; if (i >= 0 && i < 12) months[i] = Number(r.total) || 0; });
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const awalV = Number(awal.recordset[0] && awal.recordset[0].total) || 0;
  const thV = Number(thLalu.recordset[0] && thLalu.recordset[0].total) || 0;
  let saldo_awal = 0, saldo_src = null;
  if (awalV > 0) { saldo_awal = awalV; saldo_src = 'awal'; }
  else if (thV > 0) { saldo_awal = thV; saldo_src = 'th_lalu'; }
  const o = opds.find(x => x.PBSubk === code);
  return { code, name: o ? o.KetPBSubk : code, saldo_awal: round2(saldo_awal), saldo_src, months: months.map(round2), total: round2(months.reduce((s, v) => s + v, 0)), items: items.recordset };
}

// Upsert 1 baris hasil tarik ke tabel temp (tarik_temp)
async function upsertTarikTemp(r) {
  const monthPlaceholders = MONTHS.map((_, i) => `$${i + 4}`).join(', ');
  const setClause = ['saldo_awal=EXCLUDED.saldo_awal', 'saldo_src=EXCLUDED.saldo_src',
    ...MONTHS.map(m => `${m}=EXCLUDED.${m}`), 'total=EXCLUDED.total', 'pulled_at=now()'].join(', ');
  const vals = [r.code, r.saldo_awal, r.saldo_src, ...r.months, r.total];
  await pool.query(`
    INSERT INTO tarik_temp (opd_code, saldo_awal, saldo_src, ${MONTHS.join(', ')}, total, pulled_at)
    VALUES ($1, $2, $3, ${monthPlaceholders}, $${MONTHS.length + 4}, now())
    ON CONFLICT (opd_code) DO UPDATE SET ${setClause}
  `, vals);
}

app.get('/api/tarik/rekap-bulanan', requireAdmin, async (req, res) => {
  if (!mssqlGuard(req, res)) return;
  const year = 2026;
  const start = year + '-01-01', end = (year + 1) + '-01-01';
  const inList = opdsByCode.map(o => `'${opdToKey(o.PBSubk)}'`).join(',');
  const sqlThLalu = `
    ;WITH SO AS (
      SELECT LEFT(a.NoTB,16) AS opd, b.FiFo, (b.Jumlah - b.Opname) AS JmlAkhir
      FROM AsetPersediaan90.dbo.tutupbuku a WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.tutupbukudet b WITH (NOLOCK) ON a.NoTB = b.NoTB
      WHERE a.Awal >= CONVERT(DATETIME,@start,120) AND a.Awal < CONVERT(DATETIME,@end,120)
        AND LEFT(a.NoTB,16) IN (${inList})
    ),
    PDraw AS (
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,p.TglBAST) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,p.TglBast) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPA d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
      UNION ALL
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,p.TglBAST) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,p.TglBast) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPANon d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPANon p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
      UNION ALL
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,COALESCE(p.TglInput,p.TglBAST)) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,COALESCE(p.TglInput,p.TglBAST)) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPA d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
      UNION ALL
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,COALESCE(p.TglInput,p.TglBAST)) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,COALESCE(p.TglInput,p.TglBast)) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPANon d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPANon p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
    ),
    PD AS (SELECT FIFO, MAX(Harga) AS Harga FROM PDraw GROUP BY FIFO)
    SELECT s.opd, SUM(s.JmlAkhir * p.Harga) AS total
    FROM SO s JOIN PD p ON s.FiFo = p.FIFO
    GROUP BY s.opd`;
  try {
    const conn = await getMssqlPool();
    const [berjalan, awal, thLalu] = await Promise.all([
      conn.request().input('start', start).input('end', end)
        .query(`SELECT LEFT(pd.NoTerima,16) AS opd, MONTH(p.TglBAST) AS m, SUM(pd.Jumlah*pd.Harga) AS total
                 FROM AsetPersediaan90.dbo.PenerimaanDetDPA pd WITH (NOLOCK)
                 JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON pd.NoTerima = p.NoTerima
                 WHERE p.TglBAST >= CONVERT(DATETIME,@start,120) AND p.TglBAST < CONVERT(DATETIME,@end,120)
                 AND LEFT(pd.NoTerima,16) IN (${inList})
                 GROUP BY LEFT(pd.NoTerima,16), MONTH(p.TglBAST)`),
      conn.request().input('start', start).input('end', end)
        .query(`SELECT LEFT(d.NoTerima,16) AS opd, SUM(d.Jumlah*d.Harga) AS total
                 FROM AsetPersediaan90.dbo.PenerimaanDetDPANon d WITH (NOLOCK)
                 JOIN AsetPersediaan90.dbo.PenerimaanDPANon h WITH (NOLOCK) ON d.NoTerima = h.NoTerima
                 WHERE h.AsalUsul='AWAL' AND h.TglBast >= CONVERT(DATETIME,@start,120) AND h.TglBast < CONVERT(DATETIME,@end,120)
                 AND LEFT(d.NoTerima,16) IN (${inList})
                 GROUP BY LEFT(d.NoTerima,16)`),
      conn.request().input('start', start).input('end', end).query(sqlThLalu)
    ]);
    const map = {};
    const ensure = k => (map[k] = map[k] || { saldo_awal: 0, saldo_src: null, months: Array(12).fill(0) });
    awal.recordset.forEach(r => { const e = ensure(r.opd); const v = Number(r.total) || 0; if (v > 0) { e.saldo_awal = v; e.saldo_src = 'awal'; } });
    thLalu.recordset.forEach(r => { const e = ensure(r.opd); const v = Number(r.total) || 0; if (v > 0 && e.saldo_awal <= 0) { e.saldo_awal = v; e.saldo_src = 'th_lalu'; } });
    berjalan.recordset.forEach(r => { const i = Number(r.m) - 1; if (i >= 0 && i < 12) ensure(r.opd).months[i] += Number(r.total) || 0; });
    const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const data = opdsByCode.map(o => {
      const e = map[opdToKey(o.PBSubk)] || { saldo_awal: 0, saldo_src: null, months: Array(12).fill(0) };
      const months = e.months.map(round2);
      return { code: o.PBSubk, name: o.KetPBSubk, saldo_awal: round2(e.saldo_awal), saldo_src: e.saldo_src, months, total: round2(months.reduce((s, v) => s + v, 0)) };
    });
    res.json({ year, count: data.length, data });
  } catch (e) { console.error('Rekap bulanan error:', e); res.status(500).json({ error: 'Gagal menarik rekap dari sumber' }); }
});

// Rekap per OPD (drill-down): slice-sum berjalan per bulan + saldo (awal/th_lalu) + rincian item
app.get('/api/tarik/rekap-opd', requireAdmin, async (req, res) => {
  if (!mssqlGuard(req, res)) return;
  const code = req.query.opd;
  if (!code || !opds.some(o => o.PBSubk === code)) return res.status(400).json({ error: 'OPD tidak dikenal' });
  const year = 2026, start = year + '-01-01', end = (year + 1) + '-01-01';
  const key = opdToKey(code);
  const inList = `'${key}'`;
  const sqlThLalu = `
    ;WITH SO AS (
      SELECT LEFT(a.NoTB,16) AS opd, b.FiFo, (b.Jumlah - b.Opname) AS JmlAkhir
      FROM AsetPersediaan90.dbo.tutupbuku a WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.tutupbukudet b WITH (NOLOCK) ON a.NoTB = b.NoTB
      WHERE a.Awal >= CONVERT(DATETIME,@start,120) AND a.Awal < CONVERT(DATETIME,@end,120)
        AND LEFT(a.NoTB,16) IN (${inList})
    ),
    PDraw AS (
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,p.TglBAST) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,p.TglBast) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPA d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
      UNION ALL
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,p.TglBAST) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,p.TglBast) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPANon d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPANon p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
      UNION ALL
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,COALESCE(p.TglInput,p.TglBAST)) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,COALESCE(p.TglInput,p.TglBAST)) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPA d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
      UNION ALL
      SELECT d.ObjekPersediaan + '_' + CONVERT(VARCHAR(8), p.TglBast,112) + '_' +
             RIGHT('0'+CAST(DATEPART(HOUR,COALESCE(p.TglInput,p.TglBAST)) AS VARCHAR(2)),2) + ':' +
             RIGHT('0'+CAST(DATEPART(MINUTE,COALESCE(p.TglInput,p.TglBAST)) AS VARCHAR(2)),2) AS FIFO, d.Harga
      FROM AsetPersediaan90.dbo.PenerimaanDetDPANon d WITH (NOLOCK)
      JOIN AsetPersediaan90.dbo.PenerimaanDPANon p WITH (NOLOCK) ON d.NoTerima=p.NoTerima
      WHERE LEFT(d.NoTerima,16) IN (${inList})
    ),
    PD AS (SELECT FIFO, MAX(Harga) AS Harga FROM PDraw GROUP BY FIFO)
    SELECT s.opd, SUM(s.JmlAkhir * p.Harga) AS total
    FROM SO s JOIN PD p ON s.FiFo = p.FIFO
    GROUP BY s.opd`;
  try {
    const conn = await getMssqlPool();
    const [berjalan, awal, thLalu, items] = await Promise.all([
      conn.request().input('opd', key).input('start', start).input('end', end)
        .query(`SELECT MONTH(p.TglBAST) AS m, SUM(pd.Jumlah*pd.Harga) AS total
                FROM AsetPersediaan90.dbo.PenerimaanDetDPA pd WITH (NOLOCK)
                JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON pd.NoTerima = p.NoTerima
                WHERE LEFT(pd.NoTerima,16) = @opd
                  AND p.TglBAST >= CONVERT(DATETIME,@start,120) AND p.TglBAST < CONVERT(DATETIME,@end,120)
                GROUP BY MONTH(p.TglBAST)`),
      conn.request().input('opd', key).input('start', start).input('end', end)
        .query(`SELECT SUM(d.Jumlah*d.Harga) AS total
                FROM AsetPersediaan90.dbo.PenerimaanDetDPANon d WITH (NOLOCK)
                JOIN AsetPersediaan90.dbo.PenerimaanDPANon h WITH (NOLOCK) ON d.NoTerima = h.NoTerima
                WHERE h.AsalUsul='AWAL' AND h.TglBast >= CONVERT(DATETIME,@start,120) AND h.TglBast < CONVERT(DATETIME,@end,120)
                AND LEFT(d.NoTerima,16) = @opd`),
      conn.request().input('opd', key).input('start', start).input('end', end).query(sqlThLalu),
      conn.request().input('opd', key).input('start', start).input('end', end)
        .query(`SELECT d.NoTerima, op.Keterangan AS NamaBarang, d.Satuan, d.MerkType, d.Jumlah, d.Harga,
                       (d.Jumlah*d.Harga) AS TotalHarga, p.TglBAST AS BAST, p.NoBAST
                FROM AsetPersediaan90.dbo.PenerimaanDetDPA d WITH (NOLOCK)
                JOIN AsetPersediaan90.dbo.PenerimaanDPA p WITH (NOLOCK) ON d.NoTerima = p.NoTerima
                JOIN AsetMaster90.dbo.ObjekpersediaanPLU op WITH (NOLOCK) ON d.ObjekPersediaan = op.IDPLU
                WHERE LEFT(d.NoTerima,16) = @opd
                  AND p.TglBAST >= CONVERT(DATETIME,@start,120) AND p.TglBAST < CONVERT(DATETIME,@end,120)
                ORDER BY p.TglBAST ASC`)
    ]);
    const months = Array(12).fill(0);
    berjalan.recordset.forEach(r => { const i = Number(r.m) - 1; if (i >= 0 && i < 12) months[i] = Number(r.total) || 0; });
    const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const awalV = Number(awal.recordset[0] && awal.recordset[0].total) || 0;
    const thV = Number(thLalu.recordset[0] && thLalu.recordset[0].total) || 0;
    let saldo_awal = 0, saldo_src = null;
    if (awalV > 0) { saldo_awal = awalV; saldo_src = 'awal'; }
    else if (thV > 0) { saldo_awal = thV; saldo_src = 'th_lalu'; }
    const o = opds.find(x => x.PBSubk === code);
    res.json({ code, name: o ? o.KetPBSubk : code, saldo_awal: round2(saldo_awal), saldo_src, months: months.map(round2), total: round2(months.reduce((s, v) => s + v, 0)), items: items.recordset });
  } catch (e) { console.error('Rekap OPD error:', e); res.status(500).json({ error: 'Gagal menarik rekap OPD' }); }
});

// Tarik 1 OPD dari sumber (MSSQL) → simpan ke tabel temp (tarik_temp). Dipakai tombol "Tarik" di /opd/:code
app.post('/api/tarik/pull', requireAdmin, async (req, res) => {
  if (!mssqlGuard(req, res)) return;
  const code = req.query.opd;
  if (!code || !opds.some(o => o.PBSubk === code)) return res.status(400).json({ error: 'OPD tidak dikenal' });
  try {
    const r = await pullOpdFromMssql(code);
    await upsertTarikTemp(r);
    res.json({ ...r, stored: true });
  } catch (e) { console.error('Pull OPD error:', e); res.status(500).json({ error: 'Gagal menarik/menyimpan data' }); }
});

// Tarik SEMUA OPD dari sumber (MSSQL) → simpan ke tabel temp (tarik_temp)
app.post('/api/tarik/pull-all', requireAdmin, async (req, res) => {
  if (!mssqlGuard(req, res)) return;
  try {
    const data = await pullAllFromMssql();
    for (const r of data) await upsertTarikTemp(r);
    res.json({ count: data.length, stored: true });
  } catch (e) { console.error('Pull all error:', e); res.status(500).json({ error: 'Gagal menarik/menyimpan data' }); }
});

// Rekonsiliasi: bandingkan sumber (tarik_temp) vs checklist (entries) per OPD
app.get('/api/rekonsiliasi', requireAdmin, async (req, res) => {
  try {
    const [tt, ent] = await Promise.all([
      pool.query('SELECT * FROM tarik_temp'),
      pool.query('SELECT * FROM entries')
    ]);
    const ttMap = {}; tt.rows.forEach(r => { ttMap[r.opd_code] = r; });
    const entMap = {}; ent.rows.forEach(r => { entMap[r.opd_code] = r; });
    const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const data = opdsByCode.map(o => {
      const t = ttMap[o.PBSubk], e = entMap[o.PBSubk];
      const sMonths = MONTHS.map(m => t ? Number(t[m]) : 0);
      const cMonths = MONTHS.map(m => e ? Number(e[m]) : 0);
      const sSaldo = t ? Number(t.saldo_awal) : 0;
      const cSaldo = e ? Number(e.saldo_awal) : 0;
      const sTotal = t ? Number(t.total) : 0;
      const cTotal = cMonths.reduce((a, b) => a + b, 0);
      const selisih = {
        saldo_awal: round2(sSaldo - cSaldo),
        months: MONTHS.map((_, i) => round2(sMonths[i] - cMonths[i])),
        total: round2(sTotal - cTotal)
      };
      const cocok = selisih.saldo_awal === 0 && selisih.months.every(v => v === 0);
      return {
        code: o.PBSubk, name: o.KetPBSubk,
        has_sumber: !!t, has_checklist: !!e,
        sumber: { saldo_awal: sSaldo, months: sMonths, total: sTotal },
        checklist: { saldo_awal: cSaldo, months: cMonths, total: round2(cTotal) },
        selisih, cocok
      };
    });
    res.json({ count: data.length, beda: data.filter(d => !d.cokok).length, data });
  } catch (e) { console.error('Rekonsiliasi error:', e); res.status(500).json({ error: 'Gagal memuat rekonsiliasi' }); }
});

// Fallback ke index.html (SPA hash routing)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

(async () => {
  try {
    await ensureSchema();
    app.listen(PORT, () => {
      console.log('Checklist Persediaan 2026 (Postgres) berjalan di http://localhost:' + PORT);
    });
  } catch (e) {
    console.error('Gagal koneksi ke Postgres:', e.message);
    process.exit(1);
  }
})();
