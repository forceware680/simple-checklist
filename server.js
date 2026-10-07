require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Data OPD (static, dari OPDHerman.json) ---
const opds = JSON.parse(fs.readFileSync(path.join(__dirname, 'OPDHerman.json'), 'utf8'));

// --- PostgreSQL (koneksi dari .env) ---
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL belum di-set. Salin .env.example jadi .env lalu isi kredensialnya.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const COLS = ['saldo_awal', 'saldo_awal_juli', ...MONTHS, 'sem1', 'sem2'];

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      opd_code  TEXT PRIMARY KEY,
      saldo_awal INTEGER NOT NULL DEFAULT 0,
      saldo_awal_juli INTEGER NOT NULL DEFAULT 0,
      ${MONTHS.map(m => `${m} INTEGER NOT NULL DEFAULT 0`).join(',\n      ')},
      sem1 INTEGER NOT NULL DEFAULT 0,
      sem2 INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ
    )
  `);
  // migrasi: tambahkan kolom ke tabel yang sudah ada sebelumnya
  await pool.query('ALTER TABLE entries ADD COLUMN IF NOT EXISTS saldo_awal INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE entries ADD COLUMN IF NOT EXISTS saldo_awal_juli INTEGER NOT NULL DEFAULT 0');
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/opds', (req, res) => res.json(opds));

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
  const vals = {};
  for (const c of COLS) vals[c] = Math.max(0, parseInt(req.body[c], 10) || 0);
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
    const out = opds.map(o => {
      const r = map[o.PBSubk];
      const saldo_awal = (r ? Number(r.saldo_awal) : 0) || 0;
      const saldo_juli = (r ? Number(r.saldo_awal_juli) : 0) || 0;
      const months = MONTHS.map(m => (r ? Number(r[m]) : 0) || 0);
      const total_in = months.reduce((s, v) => s + v, 0);            // Jan-Des
      const in_s1 = months.slice(0, 6).reduce((s, v) => s + v, 0);   // Jan-Jun
      const in_s2 = months.slice(6).reduce((s, v) => s + v, 0);      // Jul-Des
      const total_s1_dgn = saldo_awal + in_s1;                       // saldo awal + Total Penerimaan S1
      const total_s2_dgn = saldo_juli + in_s2;                       // saldo awal Juli + Total Penerimaan S2
      const sem1 = (r ? Number(r.sem1) : 0) || 0;
      const sem2 = (r ? Number(r.sem2) : 0) || 0;
      const total_out = sem1 + sem2;
      const total_dgn_saldo = saldo_awal + total_in;                 // total penerimaan + saldo awal
      const stock1 = saldo_awal + in_s1 - sem1;                      // saldo awal + Jan-Jun - pengeluaran S1
      const stock2 = saldo_juli + in_s2 - sem2;                      // saldo awal Juli + Jul-Des - pengeluaran S2
      const stock_year = saldo_awal + total_in - total_out;          // saldo awal + Jan-Des - (S1+S2)
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
        stock_year
      };
    });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Gagal memuat rekap' });
  }
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
