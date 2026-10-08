/* Checklist Persediaan 2026 — frontend SPA (hash routing)
   Satu baris per OPD: total penerimaan per bulan (12) + total pengeluaran per semester (2). */

const MONTHS = [
  ['jan','Januari'],['feb','Februari'],['mar','Maret'],['apr','April'],['may','Mei'],['jun','Juni'],
  ['jul','Juli'],['aug','Agustus'],['sep','September'],['oct','Oktober'],['nov','November'],['dec','Desember']
];
const SEMS = [['sem1','Semester 1'],['sem2','Semester 2']];
const MONTH_SET = new Set(MONTHS.map(m => m[0]));
const S1_MONTHS = new Set(['jan','feb','mar','apr','may','jun']);

let OPDS = [];
let clCode = null, clDirty = false, clSaving = false;
const app = document.getElementById('app');

/* ---------- helpers ---------- */
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(data.error || 'Terjadi kesalahan (' + r.status + ')');
  return data;
}
const loadOpds = () => api('/api/opds').then(d => (OPDS = d));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const ID_FMT = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtID = n => ID_FMT.format(round2(Number(n) || 0));
const parseMoney = raw => { const n = parseFloat(String(raw).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const liveFormat = raw => {
  let intStr = '', decStr = '', seenDec = false;
  for (const ch of String(raw)) {
    if (ch >= '0' && ch <= '9') { if (seenDec) { if (decStr.length < 2) decStr += ch; } else intStr += ch; }
    else if (ch === ',' && !seenDec) seenDec = true;
  }
  intStr = intStr.replace(/^0+(?=\d)/, '');
  const grouped = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (grouped || '0') + (seenDec ? ',' + decStr : '');
};
function loadingBlock(text) {
  return `<div class="loading-block"><span class="spinner"></span>${esc(text)}</div>`;
}
function footer() {
  return `<footer class="foot">Checklist Persediaan 2026 · Penerimaan 12 bulan · Pengeluaran 2 semester</footer>`;
}
function header(active) {
  return `<header class="topbar">
    <a class="brand" href="#/">
      <span class="brand-mark">P26</span>
      <span class="brand-name">Checklist Persediaan <b>2026</b></span>
    </a>
    <nav class="topnav">
      <a href="#/" class="nav-link ${active === 'home' ? 'on' : ''}">Beranda</a>
      <a href="#/statistik" class="nav-link ${active === 'statistik' ? 'on' : ''}">Statistik</a>
    </nav>
  </header>`;
}

/* ---------- router ---------- */
function render() {
  const hash = location.hash || '#/';
  app.setAttribute('aria-busy', 'true');
  if (hash.startsWith('#/opd/')) renderChecklist(decodeURIComponent(hash.slice(6)));
  else if (hash === '#/statistik') renderStatistik();
  else if (hash.startsWith('#/admin')) renderAdmin();
  else renderLanding();
}

/* ---------- LANDING ---------- */
async function renderLanding() {
  app.innerHTML = header('home') + `
    <main class="wrap">
      <section class="hero">
        <div class="hero-copy">
          <span class="hero-kicker">PERSEDIAAN BARANG OPD</span>
          <h1>Checklist<br>Persediaan <span>2026</span></h1>
          <p class="hero-sub">Checklist untuk membantu <b>penyandingan data persediaan</b> OPD dengan aplikasi <b>SIMASET</b>. Catat <b>total penerimaan per bulan</b> (Jan–Des) dan <b>total pengeluaran per semester</b> (2 semester), lalu cocokkan dengan data SIMASET.</p>
        </div>
        <div class="opd-card card">
          <label class="field-label" for="opd-input">Pilih OPD / Unit kamu</label>
          <div class="opd-ac">
            <input id="opd-input" class="input big" type="text" autocomplete="off" placeholder="Ketik nama / kode OPD…" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="opd-list">
            <div id="opd-list" class="opd-list" role="listbox" aria-label="Daftar OPD" hidden></div>
          </div>
        </div>
      </section>

      <section class="howto card">
        <h2>Cara pakai</h2>
        <ol class="steps">
          <li>Ketik <b>nama / kode OPD</b> kamu, lalu pilih dari daftar.</li>
          <li>Isi <b>Saldo Awal 2026</b> — stok di awal tahun (dasar Stock Opname S1).</li>
          <li>Isi <b>total penerimaan</b> tiap bulan (Jan–Des).</li>
          <li>Isi <b>total pengeluaran</b> tiap semester (S1 &amp; S2).</li>
          <li><b>Saldo Awal Juli</b> terisi otomatis — nggak perlu diketik.</li>
          <li>Klik <b>Simpan Checklist</b> — total &amp; stock opname terhitung otomatis.</li>
          <li>Cocokkan angka di menu <b>Statistik</b> dengan data <b>SIMASET</b>.</li>
        </ol>
        <span class="note-chip">Penerimaan: 12 bulan &nbsp;·&nbsp; Pengeluaran: 2 semester &nbsp;·&nbsp; Saldo Awal Juli &amp; Stock opname: otomatis &nbsp;·&nbsp; Angka: max 2 desimal</span>
      </section>
    </main>
    ${footer()}`;

  const input = document.getElementById('opd-input');
  const list = document.getElementById('opd-list');
  let activeIdx = -1;
  let docHandler = null;

  const go = code => { if (clDirty && !confirmLeave()) return; location.hash = '#/opd/' + encodeURIComponent(code); };
  const matches = q => {
    const s = q.trim().toLowerCase();
    if (!s) return OPDS;
    return OPDS.filter(o => (o.KetPBSubk + ' ' + o.PBSubk).toLowerCase().includes(s));
  };
  const renderList = q => {
    const items = matches(q);
    list.innerHTML = items.length
      ? items.map((o, i) => `<li role="option" data-code="${esc(o.PBSubk)}" class="${i === activeIdx ? 'active' : ''}"><span class="opd-ac-name">${esc(o.KetPBSubk)}</span><span class="opd-ac-code">${esc(o.PBSubk)}</span></li>`).join('')
      : '<li class="opd-empty">Tidak ada OPD cocok</li>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const setActive = idx => {
    const items = [...list.querySelectorAll('li[role=option]')];
    if (!items.length) return;
    activeIdx = (idx + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle('active', i === activeIdx));
    input.value = items[activeIdx].querySelector('.opd-ac-name').textContent;
    items[activeIdx].scrollIntoView({ block: 'nearest' });
  };
  const hideList = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };

  try {
    await loadOpds();
  } catch (err) {
    input.disabled = true;
    input.placeholder = 'Gagal memuat daftar OPD';
    return;
  }

  if (docHandler) document.removeEventListener('click', docHandler);
  docHandler = e => { if (!e.target.closest('.opd-ac')) hideList(); };
  document.addEventListener('click', docHandler);

  input.addEventListener('input', () => { activeIdx = -1; renderList(input.value); });
  input.addEventListener('focus', () => renderList(input.value));
  input.addEventListener('keydown', e => {
    const items = [...list.querySelectorAll('li[role=option]')];
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const cur = items[activeIdx >= 0 ? activeIdx : 0]; if (cur) go(cur.dataset.code); }
    else if (e.key === 'Escape') hideList();
  });
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('li[role=option]');
    if (li) { e.preventDefault(); go(li.dataset.code); }
  });
}

/* ---------- CHECKLIST ---------- */
async function renderChecklist(code) {
  const opd = OPDS.find(o => o.PBSubk === code);
  if (!opd) {
    app.innerHTML = header() + `<main class="wrap">
      <div class="card error-state">OPD tidak ditemukan. <a href="#/">Kembali ke beranda</a></div>
    </main>` + footer();
    return;
  }
  clCode = code; clDirty = false; clSaving = false;
  window.removeEventListener('beforeunload', clUnload);
  app.innerHTML = header() + `
    <main class="wrap">
      <div class="cl-head">
        <a href="#/" class="btn ghost">← Kembali Ke Beranda</a>
        <div class="cl-title">
          <span class="cl-kicker">OPD / UNIT</span>
          <h1>${esc(opd.KetPBSubk)}</h1>
          <span class="cl-code">${esc(opd.PBSubk)}</span>
        </div>
      </div>
      <div id="cl-body" class="cl-body">${loadingBlock('Memuat checklist…')}</div>
    </main>
    ${footer()}`;

  try {
    const entry = await api('/api/opds/' + encodeURIComponent(code));
    const body = document.getElementById('cl-body');
    body.innerHTML = buildForm(entry);
    attachFormListeners();
  } catch (err) {
    document.getElementById('cl-body').innerHTML =
      `<div class="card error-state">Gagal memuat data: ${esc(err.message)}.
        <div class="savebar"><button class="btn primary" onclick="location.reload()">Coba lagi</button></div></div>`;
  }
}

function buildForm(entry) {
  entry = entry || {};
  const inRows = MONTHS.map(([k, label]) =>
    `<div class="frow">
       <span class="frow-label">${label}</span>
       <input type="text" inputmode="decimal" class="num big" data-field="${k}"
         value="${fmtID(entry[k] || 0)}" aria-label="Total penerimaan ${label}">
     </div>`).join('');
  const outRows = SEMS.map(([k, label]) =>
    `<div class="frow">
       <span class="frow-label">${label}</span>
       <input type="text" inputmode="decimal" class="num big" data-field="${k}"
         value="${fmtID(entry[k] || 0)}" aria-label="Total pengeluaran ${label}">
     </div>`).join('');

  return `
    <section class="card cl-sec cl-awal">
      <h2 class="cl-sec-title awal">Saldo Awal</h2>
      <div class="frows">
        <div class="frow">
          <span class="frow-label">Saldo Awal 2026</span>
          <input type="text" inputmode="decimal" class="num big" data-field="saldo_awal"
            value="${fmtID(entry.saldo_awal || 0)}" aria-label="Saldo Awal 2026">
        </div>
        <div class="frow">
          <span class="frow-label">Saldo Awal Juli <span class="auto-tag">otomatis</span></span>
          <div class="tip">
            <input type="text" inputmode="decimal" class="num big auto" data-field="saldo_awal_juli"
              value="${fmtID(entry.saldo_awal_juli || 0)}" aria-label="Saldo Awal Juli (otomatis)" aria-describedby="saldo-juli-tip" readonly>
            <span class="tip-bubble" id="saldo-juli-tip" role="tooltip">Terisi otomatis dari <b>(Total S1 + Awal) &minus; (Pengeluaran S1)</b>. Tidak bisa di isi manual.</span>
          </div>
        </div>
      </div>
      <p class="cl-awal-note">Saldo Awal 2026 = stok di awal tahun (dasar Stock Opname S1). <b>Saldo Awal Juli terisi otomatis</b> = (Total S1 + Awal) &minus; (Pengeluaran S1).</p>
    </section>

    <div class="cl-grid">
      <section class="card cl-sec">
        <h2 class="cl-sec-title in">Penerimaan <span>per bulan</span></h2>
        <div class="frows">${inRows}</div>
        <div class="subline"><span>Subtotal penerimaan</span><b class="tot-in">0</b></div>
      </section>
      <section class="card cl-sec">
        <h2 class="cl-sec-title out">Pengeluaran <span>per semester</span></h2>
        <div class="frows">${outRows}</div>
        <div class="subline"><span>Subtotal pengeluaran</span><b class="tot-out">0</b></div>
      </section>
    </div>

    <div class="ringkasan">
      <div class="rk in"><span>Total Penerimaan</span><b class="rk-in">0</b></div>
      <div class="rk out"><span>Total Pengeluaran</span><b class="rk-out">0</b></div>
      <div class="rk stock"><span>Stock Opname S1</span><b class="rk-stock1">0</b></div>
      <div class="rk stock"><span>Stock Opname S2</span><b class="rk-stock2">0</b></div>
      <div class="rk stock"><span>Stock Opname Tahunan</span><b class="rk-stocky">0</b></div>
    </div>

    <div class="savebar">
      <div id="save-msg" class="save-msg" role="status" aria-live="polite"></div>
      <button id="save-btn" class="btn primary">Simpan Checklist</button>
    </div>`;
}

function paintTotals() {
  let inT = 0, outT = 0, inS1 = 0, outS1 = 0, outS2 = 0, saldoAwal = 0;
  document.querySelectorAll('#cl-body input[data-field]').forEach(inp => {
    const v = round2(parseMoney(inp.value));
    const f = inp.dataset.field;
    if (f === 'saldo_awal_juli') return;      // terhitung otomatis, tidak dibaca dari input
    if (f === 'saldo_awal') { saldoAwal = v; return; }
    if (MONTH_SET.has(f)) { inT += v; if (S1_MONTHS.has(f)) inS1 += v; }
    else { outT += v; if (f === 'sem1') outS1 = v; else if (f === 'sem2') outS2 = v; }
  });
  const inS2 = inT - inS1;                    // Jul-Des
  const stock1 = saldoAwal + inS1 - outS1;    // saldo awal + Jan-Jun - pengeluaran S1
  const saldoJuli = stock1;                   // Saldo Awal Juli = (Total S1+Awal) - Pengeluaran S1
  const stock2 = saldoJuli + inS2 - outS2;    // saldo awal Juli + Jul-Des - pengeluaran S2
  const stockYear = saldoAwal + inT - outT;   // saldo awal + Jan-Des - pengeluaran tahunan
  const salJuliEl = document.querySelector('#cl-body input[data-field="saldo_awal_juli"]');
  if (salJuliEl) salJuliEl.value = fmtID(saldoJuli); // isi otomatis
  const set = (cls, val) => { const el = document.querySelector('.' + cls); if (el) el.textContent = fmtID(val); };
  set('tot-in', inT); set('tot-out', outT);
  set('rk-in', inT); set('rk-out', outT);
  set('rk-stock1', stock1); set('rk-stock2', stock2); set('rk-stocky', stockYear);
  document.querySelector('.rk-stock1')?.classList.toggle('neg', stock1 < 0);
  document.querySelector('.rk-stock2')?.classList.toggle('neg', stock2 < 0);
  document.querySelector('.rk-stocky')?.classList.toggle('neg', stockYear < 0);
}

function attachFormListeners() {
  document.querySelectorAll('#cl-body input[data-field]').forEach(inp => {
    inp.addEventListener('input', () => {
      if (!inp.readOnly) {
        inp.value = liveFormat(inp.value);
        paintTotals();
        setDirty(true);
      }
    });
    inp.addEventListener('blur', () => {
      if (!inp.readOnly) inp.value = fmtID(parseMoney(inp.value));
    });
  });
  paintTotals();
  document.getElementById('save-btn').addEventListener('click', () => doSave());
}

function clUnload(e) {
  if (clDirty && !clSaving) { e.preventDefault(); e.returnValue = ''; }
}
function confirmLeave() {
  return window.confirm('Masih ada data yang belum disimpan.\n\nYakin mau keluar? Perubahan yang belum disimpan akan hilang.');
}
function guardHashNav(e) {
  const a = e.target.closest('a[href^="#"]');
  if (a && clDirty && !confirmLeave()) e.preventDefault();
}
function setDirty(dirty) {
  clDirty = dirty;
  const msg = document.getElementById('save-msg');
  if (dirty) {
    if (msg) { msg.className = 'save-msg'; msg.textContent = 'Belum disimpan…'; }
    window.addEventListener('beforeunload', clUnload);
  } else {
    window.removeEventListener('beforeunload', clUnload);
  }
}
async function doSave() {
  if (clSaving || !clCode) return;
  const btn = document.getElementById('save-btn');
  const msg = document.getElementById('save-msg');
  clSaving = true;
  if (btn) btn.disabled = true;
  const data = {};
  document.querySelectorAll('#cl-body input[data-field]').forEach(inp => {
    data[inp.dataset.field] = round2(parseMoney(inp.value));
  });
  if (msg) { msg.className = 'save-msg'; msg.textContent = 'Menyimpan…'; }
  try {
    await api('/api/opds/' + encodeURIComponent(clCode), { method: 'PUT', body: JSON.stringify(data) });
    const t = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    if (msg) { msg.className = 'save-msg ok'; msg.textContent = 'Tersimpan ' + t + ' ✓'; }
    if (btn) { btn.textContent = 'Tersimpan ✓'; setTimeout(() => { btn.textContent = 'Simpan Checklist'; }, 2000); }
    setDirty(false);
  } catch (err) {
    if (msg) { msg.className = 'save-msg err'; msg.textContent = 'Gagal menyimpan: ' + err.message; }
  }
  clSaving = false;
  if (btn) btn.disabled = false;
}

/* ---------- STATISTIK ---------- */
const MLBL = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

async function renderStatistik() {
  app.innerHTML = header('statistik') + `
    <main class="wrap" id="stats-wrap">
      <h1 class="page-title">Statistik</h1>
      <p class="page-sub">Rekap seluruh OPD: penerimaan per bulan &amp; pengeluaran per semester.</p>
      <section class="card admin-summary">
        <div class="sum-head">
          <h2>Rekap OPD</h2>
          <div class="sum-actions">
            <input id="opd-search" class="search" type="search" placeholder="Cari nama / kode OPD…" aria-label="Cari nama atau kode OPD">
            <button id="fs-btn" class="btn ghost" type="button">Full Screen</button>
          </div>
        </div>
        <div id="summary">${loadingBlock('Memuat rekap…')}</div>
      </section>
    </main>
    ${footer()}`;
  const wrap = document.getElementById('stats-wrap');
  document.getElementById('fs-btn').addEventListener('click', () => {
    const on = wrap.classList.toggle('full');
    document.getElementById('fs-btn').textContent = on ? 'Keluar Full Screen' : 'Full Screen';
  });
  const searchInput = document.getElementById('opd-search');
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    document.querySelectorAll('#summary tbody tr').forEach(tr => {
      tr.style.display = tr.dataset.search.includes(q) ? '' : 'none';
    });
  });
  try {
    const sum = await api('/api/statistik');
    renderSummary(sum);
  } catch (err) {
    document.getElementById('summary').innerHTML = `<div class="error-state">Gagal memuat: ${esc(err.message)}</div>`;
  }
}

function renderSummary(sum) {
  const el = document.getElementById('summary');
  const done = sum.filter(s => s.filled).length;
  const monthThS1 = MLBL.slice(0, 6).map(m => `<th class="n m">${m}</th>`).join('');
  const monthThS2 = MLBL.slice(6).map(m => `<th class="n m">${m}</th>`).join('');
  el.innerHTML = `<div class="summary-stat"><b>${done}</b> dari ${sum.length} OPD sudah terisi</div>
    <div class="sum-table">
      <table>
        <thead>
          <tr class="grp">
            <th class="stick" rowspan="2">OPD</th>
            <th rowspan="2" class="saldo">Saldo Awal</th>
            <th colspan="6" class="grp-in">Penerimaan S1 (Jan–Jun)</th>
            <th rowspan="2" class="tin">Total S1</th>
            <th rowspan="2" class="tin">Total S1 + Awal</th>
            <th rowspan="2" class="saldo">Saldo Awal Juli</th>
            <th colspan="6" class="grp-in">Penerimaan S2 (Jul–Des)</th>
            <th rowspan="2" class="tin">Total S2</th>
            <th rowspan="2" class="tin">Total S2 + Awal</th>
            <th colspan="2" class="grp-in">Penerimaan Tahunan</th>
            <th colspan="3" class="grp-out">Pengeluaran</th>
            <th colspan="3" class="grp-stock">Stock Opname</th>
            <th colspan="2" class="grp-rec">Rekonsiliasi SIMASET</th>
          </tr>
          <tr>
            ${monthThS1}
            ${monthThS2}
            <th class="n strong tin">Total</th>
            <th class="n tin">+Awal</th>
            <th class="n m">S1</th>
            <th class="n m">S2</th>
            <th class="n strong tout">Tahunan</th>
            <th class="n m">S1</th>
            <th class="n m">S2</th>
            <th class="n strong stok">Tahunan</th>
            <th class="n rec">Opname Simaset 2026</th>
            <th class="n rec">Selisih</th>
          </tr>
        </thead>
        <tbody>${sum.map(s => `
          <tr data-search="${esc((s.name + ' ' + s.code).toLowerCase())}">
            <td class="stick"><span class="opd-name">${esc(s.name)}</span><span class="sum-code">${esc(s.code)}${s.filled ? '' : '<span class="badge belum">Belum</span>'}</span></td>
            <td class="n saldo">${fmtID(s.saldo_awal)}</td>
            ${s.months.slice(0, 6).map(v => `<td class="n">${fmtID(v)}</td>`).join('')}
            <td class="n tot-in">${fmtID(s.in_s1)}</td>
            <td class="n tot-in">${fmtID(s.total_s1_dgn)}</td>
            <td class="n saldo">${fmtID(s.saldo_juli)}</td>
            ${s.months.slice(6).map(v => `<td class="n">${fmtID(v)}</td>`).join('')}
            <td class="n tot-in">${fmtID(s.in_s2)}</td>
            <td class="n tot-in">${fmtID(s.total_s2_dgn)}</td>
            <td class="n strong tot-in">${fmtID(s.total_in)}</td>
            <td class="n tot-in">${fmtID(s.total_dgn_saldo)}</td>
            <td class="n">${fmtID(s.sem1)}</td>
            <td class="n">${fmtID(s.sem2)}</td>
            <td class="n strong tot-out">${fmtID(s.total_out)}</td>
            <td class="n stock${s.stock1 < 0 ? ' neg' : ''}">${fmtID(s.stock1)}</td>
            <td class="n stock${s.stock2 < 0 ? ' neg' : ''}">${fmtID(s.stock2)}</td>
            <td class="n strong stok${s.stock_year < 0 ? ' neg' : ''}">${fmtID(s.stock_year)}</td>
            <td class="n rec">${fmtID(s.opname_simaset)}</td>
            <td class="n rec selisih${s.selisih < 0 ? ' neg' : ''}${s.selisih === 0 ? ' zero' : ''}">${fmtID(s.selisih)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

/* ---------- ADMIN (tersembunyi, #/admin) ---------- */
let adminStock = {};
async function renderAdmin() {
  app.setAttribute('aria-busy', 'true');
  let me = { authenticated: false };
  try { me = await api('/api/admin/me'); } catch (e) {}
  if (!me.authenticated) return renderAdminLogin();
  return renderAdminPanel();
}
function renderAdminLogin() {
  app.innerHTML = header() + `
    <main class="wrap admin">
      <div class="card admin-login">
        <h2>Login Admin</h2>
        <p class="admin-sub">Area khusus admin untuk rekonsiliasi data <b>SIMASET</b>.</p>
        <form id="admin-login-form">
          <div class="frow"><label class="field-label" for="al-user">Username</label><input type="text" id="al-user" autocomplete="username" required></div>
          <div class="frow"><label class="field-label" for="al-pass">Password</label><input type="password" id="al-pass" autocomplete="current-password" required></div>
          <button type="submit" class="btn primary">Masuk</button>
          <div class="save-msg" id="al-msg" role="status" aria-live="polite"></div>
        </form>
      </div>
    </main>` + footer();
  document.getElementById('admin-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = document.getElementById('al-msg');
    msg.className = 'save-msg'; msg.textContent = 'Memeriksa…';
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: document.getElementById('al-user').value, password: document.getElementById('al-pass').value }) });
      renderAdmin();
    } catch (err) {
      msg.className = 'save-msg err'; msg.textContent = err.message;
    }
  });
}
async function renderAdminPanel() {
  app.innerHTML = header() + `
    <main class="wrap admin">
      <div class="admin-head">
        <div>
          <h1 class="page-title">Rekonsiliasi <span>SIMASET</span></h1>
          <p class="page-sub">Isi <b>Opname Simaset 2026</b> per OPD. Kolom <b>Selisih</b> terhitung otomatis terhadap Stock Opname Tahunan.</p>
        </div>
        <div class="admin-tools">
          <input id="opd-search-admin" class="search" type="search" placeholder="Cari nama / kode OPD…" aria-label="Cari nama atau kode OPD">
          <button class="btn ghost" id="admin-logout" type="button">Keluar</button>
        </div>
      </div>
      <div class="card admin-card">
        <div class="admin-table">
          <table>
            <thead><tr>
              <th class="opd-col">OPD</th>
              <th class="n">Stock Opname Tahunan</th>
              <th class="n">Opname Simaset 2026</th>
              <th class="n">Selisih</th>
            </tr></thead>
            <tbody id="admin-tbody"><tr class="loading-row"><td colspan="4"><span class="spinner"></span>Memuat…</td></tr></tbody>
          </table>
        </div>
        <div class="admin-actions">
          <button class="btn primary" id="admin-save" type="button">Simpan Semua</button>
          <div class="save-msg" id="admin-msg" role="status" aria-live="polite"></div>
        </div>
      </div>
    </main>` + footer();
  document.getElementById('admin-logout').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch (e) {}
    renderAdminLogin();
  });
  document.getElementById('admin-save').addEventListener('click', saveAdmin);
  const searchEl = document.getElementById('opd-search-admin');
  searchEl.addEventListener('input', () => {
    const q = searchEl.value.trim().toLowerCase();
    document.querySelectorAll('#admin-tbody tr[data-code]').forEach(tr => {
      tr.style.display = tr.dataset.search.includes(q) ? '' : 'none';
    });
  });
  try {
    const data = await api('/api/admin/rekonsiliasi');
    adminStock = {};
    data.forEach(r => { adminStock[r.code] = r.stock_year; });
    document.getElementById('admin-tbody').innerHTML = data.map(r => `
      <tr data-code="${esc(r.code)}" data-search="${esc((r.name + ' ' + r.code).toLowerCase())}">
        <td class="opd-col"><span class="opd-name">${esc(r.name)}</span><span class="sum-code">${esc(r.code)}</span></td>
        <td class="n">${fmtID(r.stock_year)}</td>
        <td class="n"><input type="text" inputmode="decimal" class="num admin-inp" data-code="${esc(r.code)}" value="${fmtID(r.opname_simaset)}" aria-label="Opname Simaset 2026 ${esc(r.name)}"></td>
        <td class="n selisih" data-selisih="${esc(r.code)}">${fmtID(r.selisih)}</td>
      </tr>`).join('');
    document.querySelectorAll('#admin-tbody .admin-inp').forEach(inp => {
      inp.addEventListener('input', () => { inp.value = liveFormat(inp.value); updateAdminSelisih(inp.dataset.code); });
      inp.addEventListener('blur', () => { inp.value = fmtID(parseMoney(inp.value)); updateAdminSelisih(inp.dataset.code); });
    });
    app.setAttribute('aria-busy', 'false');
  } catch (err) {
    document.getElementById('admin-tbody').innerHTML = `<tr><td colspan="4" class="error-state">Gagal memuat: ${esc(err.message)}</td></tr>`;
    app.setAttribute('aria-busy', 'false');
  }
}
function updateAdminSelisih(code) {
  const inp = document.querySelector(`#admin-tbody .admin-inp[data-code="${code}"]`);
  const cell = document.querySelector(`#admin-tbody [data-selisih="${code}"]`);
  if (!inp || !cell) return;
  const sel = round2(parseMoney(inp.value) - (adminStock[code] || 0));
  cell.textContent = fmtID(sel);
  cell.classList.toggle('neg', sel < 0);
  cell.classList.toggle('zero', sel === 0);
}
async function saveAdmin() {
  const msg = document.getElementById('admin-msg');
  const btn = document.getElementById('admin-save');
  btn.disabled = true; msg.className = 'save-msg'; msg.textContent = 'Menyimpan…';
  try {
    const inputs = [...document.querySelectorAll('#admin-tbody .admin-inp')];
    await Promise.all(inputs.map(inp =>
      api('/api/admin/opname/' + encodeURIComponent(inp.dataset.code), { method: 'PUT', body: JSON.stringify({ opname_simaset: round2(parseMoney(inp.value)) }) })));
    msg.className = 'save-msg ok'; msg.textContent = 'Tersimpan ✓';
  } catch (err) {
    msg.className = 'save-msg err'; msg.textContent = 'Gagal: ' + err.message;
  }
  btn.disabled = false;
}

/* ---------- boot ---------- */
(async function init() {
  window.addEventListener('hashchange', render);
  document.addEventListener('click', guardHashNav);
  try {
    await loadOpds();
  } catch (e) {
    app.innerHTML = `<div class="boot-error">Gagal memuat aplikasi.<br>
      Pastikan server berjalan, lalu muat ulang halaman.</div>`;
    return;
  }
  render();
})();
