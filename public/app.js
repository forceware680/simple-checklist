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
  return `<footer class="foot">© 2026 Bidang Aset</footer>`;
}
function header(active) {
  return `<header class="topbar">
    <a class="brand" href="#/">
      <span class="brand-mark">P26</span>
      <span class="brand-name">Rekonsiliasi Persediaan <b>2026</b></span>
    </a>
    <nav class="topnav">
      <a href="#/" class="nav-link ${active === 'home' ? 'on' : ''}">Beranda</a>
      <a href="#/pp-pakai-habis" class="nav-link ${active === 'pp' ? 'on' : ''}">Laporan Manual</a>
      <a href="#/rekap" class="nav-link ${active === 'rekap' ? 'on' : ''}">SIMASET</a>
      <a href="#/rekonsiliasi" class="nav-link ${active === 'rekonsiliasi' ? 'on' : ''}">Rekonsiliasi</a>
    </nav>
  </header>`;
}

/* ---------- router ---------- */
function render() {
  const hash = location.hash || '#/';
  app.setAttribute('aria-busy', 'true');
  if (hash.startsWith('#/opd/')) renderChecklist(decodeURIComponent(hash.slice(6)));
  else if (hash === '#/pp-pakai-habis') renderStatistik();
  else if (hash.startsWith('#/rekap/')) renderRekapOpd(decodeURIComponent(hash.slice(8)));
  else if (hash === '#/rekap') renderRekap();
  else if (hash === '#/rekonsiliasi') renderRekonsiliasi();
  else if (hash.startsWith('#/admin')) renderAdmin();
  else renderLanding();
}

/* ---------- LANDING ---------- */
async function renderLanding() {
  app.innerHTML = header('home') + `
    <main class="wrap">
      <section class="hero">
        <div class="hero-copy">
          <h1>Rekonsiliasi Persediaan<br>Tahun Anggaran <span>2026</span></h1>
          <p class="hero-sub">Membandingkan data <b>SIMASET</b> dengan <b>Laporan Manual</b> persediaan tiap OPD.</p>
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
        <p class="howto-lead">Angka yang kamu isi berdasarkan <span class="src">Laporan Manual</span> OPD kamu.</p>
        <ol class="steps">
          <li>Ketik <b>nama / kode OPD</b> kamu, lalu pilih dari daftar.</li>
          <li>Isi <b>Saldo Awal 2026</b>, stok di awal tahun (dasar Saldo Akhir Semester 1).</li>
          <li>Isi <b>total penerimaan</b> tiap bulan (Jan–Des), satu angka <b>total</b> per bulan, <b>bukan per barang</b>.</li>
          <li>Isi <b>total pengeluaran</b> tiap semester (S1 &amp; S2), juga <b>total</b>, bukan per barang.</li>
          <li><b>Saldo Awal Juli</b>, total, dan <b>Saldo Akhir</b> terhitung otomatis, nggak perlu diketik.</li>
          <li>Klik <b>Simpan</b>. Mau keluar sebelum simpan? Akan ada peringatan dulu.</li>
          <li>Untuk melihat <b>rekap data SIMASET persediaan per bulan</b>, buka/klik <b>SIMASET</b> di menu navigasi.</li>
          <li>Untuk melihat <b>rekonsiliasi data Laporan Manual vs SIMASET</b>, buka/klik <b>Rekonsiliasi</b> di menu navigasi.</li>
          <li>Jika menemukan <b>selisih</b>, segera <b>tindak lanjuti</b>.</li>
        </ol>
        <span class="note-chip">Total per OPD (bukan per barang) &nbsp;·&nbsp; Penerimaan: 12 bulan &nbsp;·&nbsp; Pengeluaran: 2 semester &nbsp;·&nbsp; Saldo Awal Juli &amp; Saldo Akhir: otomatis &nbsp;·&nbsp; Max 2 desimal</span>
        <p class="howto-note">Tugas kamu sampai di <b>Simpan</b>. Angka <b>saldo akhir</b> yang kamu hasilkan nanti <b>dicocokkan dengan SIMASET oleh admin</b>. Kamu tidak perlu mengisi bagian SIMASET.</p>
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
          <p class="cl-sub">Isi data persediaan dari <b>Laporan Manual</b>: saldo awal, penerimaan per bulan, dan pengeluaran per semester.</p>
        </div>
      </div>
      <div id="cl-body" class="cl-body">${loadingBlock('Memuat Laporan Manual…')}</div>
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
      <p class="cl-awal-note">Saldo Awal 2026 = stok di awal tahun (dasar Saldo Akhir S1). <b>Saldo Awal Juli terisi otomatis</b> = (Total S1 + Awal) &minus; (Pengeluaran S1).</p>
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
      <div class="rk stock"><span>Saldo Akhir S1</span><b class="rk-stock1">0</b></div>
      <div class="rk stock"><span>Saldo Akhir S2</span><b class="rk-stock2">0</b></div>
      <div class="rk stock"><span>Saldo Akhir Tahunan</span><b class="rk-stocky">0</b></div>
    </div>

    <div class="savebar">
      <div id="save-msg" class="save-msg" role="status" aria-live="polite"></div>
      <div class="savebar-btns">
        <button id="save-btn" class="btn primary">Simpan</button>
      </div>
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
    if (btn) { btn.textContent = 'Tersimpan ✓'; setTimeout(() => { btn.textContent = 'Simpan'; }, 2000); }
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
  app.innerHTML = header('pp') + `
    <main class="wrap" id="stats-wrap">
      <h1 class="page-title">Laporan Manual</h1>
      <p class="page-sub">Rekap data <b>Laporan Manual</b> seluruh OPD: penerimaan per bulan, pengeluaran per semester, dan saldo akhir.</p>
      <section class="card admin-summary">
        <div class="sum-head">
          <h2>Rekap PP Pakai Habis Per OPD</h2>
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
            <th colspan="3" class="grp-stock">Saldo Akhir</th>
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
            <th class="n rec">Saldo Akhir SIMASET 2026</th>
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

/* ---------- REKAP BULANAN (sheet read-only, #/rekap) ---------- */
async function renderRekap() {
  app.innerHTML = header('rekap') + `
    <main class="wrap" id="rekap-wrap">
      <h1 class="page-title">SIMASET</h1>
      <p class="page-sub">Data persediaan dari <b>SIMASET</b> (sumber resmi) per OPD. Total <b>nilai (TotalHarga)</b> penerimaan per bulan (TA 2026). <b>Saldo Awal</b> = saldo awal th; jika 0 → otomatis <b>saldo th lalu</b>. Kolom bulan dari tanggal <b>BAST</b> saldo berjalan.</p>
      <div id="rekap-body">${loadingBlock('Memuat rekap…')}</div>
    </main>
    ${footer()}`;
  // Halaman publik; tombol "Tarik Semua" cuma muncul buat admin
  const me = await api('/api/admin/me').catch(() => ({ authenticated: false }));
  renderRekapTable(!!me.authenticated);
}

function renderRekapTable(isAdmin) {
  const body = document.getElementById('rekap-body');
  const wrap = document.getElementById('rekap-wrap');
  body.innerHTML = `
    <section class="card admin-summary">
      <div class="sum-head">
        <h2>Rekap Penginputan SIMASET <span class="rekap-tag">TA 2026</span></h2>
        <div class="sum-actions">
          <input id="rekap-search" class="search" type="search" placeholder="Cari nama / kode OPD…" aria-label="Cari OPD">
          ${isAdmin ? '<button id="rekap-pullall" class="btn ghost" type="button">Tarik Semua ke Temp</button>' : ''}
          <button id="rekap-fs" class="btn ghost" type="button">Full Screen</button>
        </div>
      </div>
      <p class="rekap-note">Kolom <b>Saldo Awal</b> = saldo awal th; jika 0, otomatis pakai <b>saldo th lalu</b> (penanda <span class="saldo-tag">th</span>).</p>
      <div id="rekap-summary">${loadingBlock('Memuat…')}</div>
    </section>`;
  wrap.querySelector('#rekap-fs').addEventListener('click', () => {
    const on = wrap.classList.toggle('full');
    wrap.querySelector('#rekap-fs').textContent = on ? 'Keluar Full Screen' : 'Full Screen';
  });
  const pullAllBtn = wrap.querySelector('#rekap-pullall');
  if (pullAllBtn) pullAllBtn.addEventListener('click', rekapPullAll);
  wrap.querySelector('#rekap-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#rekap-summary tbody tr').forEach(tr => {
      tr.style.display = tr.dataset.search.includes(q) ? '' : 'none';
    });
  });
  loadRekap(2026);
}

// Tarik SEMUA OPD dari sumber → simpan ke tabel temp (tarik_temp)
async function rekapPullAll() {
  const btn = document.getElementById('rekap-pullall');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'Menarik semua…';
  try {
    const r = await api('/api/tarik/pull-all', { method: 'POST' });
    btn.textContent = r.count + ' OPD tersimpan ✓';
  } catch (err) {
    btn.textContent = 'Gagal menarik';
  }
  btn.disabled = false;
  setTimeout(() => { btn.textContent = 'Tarik Semua ke Temp'; }, 3000);
}

async function loadRekap(year) {
  const el = document.getElementById('rekap-summary');
  try {
    const r = await api('/api/tarik/rekap-bulanan?year=' + year);
    renderRekapRows(r);
  } catch (err) {
    el.innerHTML = `<div class="error-state">Gagal memuat: ${esc(err.message)}</div>`;
  }
}

function renderRekapRows(r) {
  const el = document.getElementById('rekap-summary');
  const done = r.data.filter(d => d.total > 0 || d.saldo_awal > 0).length;
  const mS1 = MLBL.slice(0, 6).map(m => `<th class="n m">${m}</th>`).join('');
  const mS2 = MLBL.slice(6).map(m => `<th class="n m">${m}</th>`).join('');
  el.innerHTML = `<div class="summary-stat"><b>${done}</b> dari ${r.data.length} OPD punya data tahun ${r.year}</div>
    <div class="sum-table rekap">
      <table>
        <thead>
          <tr class="grp">
            <th class="stick" rowspan="2">OPD</th>
            <th rowspan="2" class="saldo">Saldo Awal</th>
            <th colspan="6" class="grp-in">Penerimaan S1 (Jan–Jun)</th>
            <th colspan="6" class="grp-in">Penerimaan S2 (Jul–Des)</th>
            <th rowspan="2" class="tin strong">Total</th>
          </tr>
          <tr>${mS1}${mS2}</tr>
        </thead>
        <tbody>${r.data.map(d => `
          <tr data-search="${esc((d.name + ' ' + d.code).toLowerCase())}">
            <td class="stick"><a class="opd-link" href="#/rekap/${encodeURIComponent(d.code)}"><span class="opd-name">${esc(d.name)}</span></a><span class="sum-code">${esc(d.code)}</span><button class="btn ghost rekap-pull-btn" data-code="${d.code}" type="button">Update Data</button></td>
            <td class="n saldo">${fmtID(d.saldo_awal)}${d.saldo_src === 'th_lalu' ? '<span class="saldo-tag" title="Saldo th lalu (fallback)">th</span>' : ''}</td>
            ${d.months.slice(0,6).map(v => `<td class="n">${fmtID(v)}</td>`).join('')}
            ${d.months.slice(6).map(v => `<td class="n">${fmtID(v)}</td>`).join('')}
            <td class="n strong tot-in">${fmtID(d.saldo_awal + d.total)}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
  el.querySelectorAll('.rekap-pull-btn').forEach(btn => btn.addEventListener('click', () => rekapPullOne(btn)));
}

// Tarik 1 OPD dari sumber → upsert ke tarik_temp (cuma OPD itu yang ter-update)
async function rekapPullOne(btn) {
  const code = btn.dataset.code;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await api('/api/tarik/pull?opd=' + encodeURIComponent(code), { method: 'POST' });
    btn.textContent = '✓';
    const tr = btn.closest('tr');
    const tds = tr.querySelectorAll('td');
    tds[1].innerHTML = fmtID(r.saldo_awal) + (r.saldo_src === 'th_lalu' ? '<span class="saldo-tag" title="Saldo th lalu (fallback)">th</span>' : '');
    r.months.forEach((v, i) => { tds[2 + i].textContent = fmtID(v); });
    tds[14].textContent = fmtID(r.total);
  } catch (err) {
    btn.textContent = '✕';
  }
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2500);
}

/* ---------- REKAP PER OPD (drill-down, #/rekap/:code) ---------- */
async function renderRekapOpd(code) {
  app.innerHTML = header('rekap') + `
    <main class="wrap">
      <h1 class="page-title" id="rekapopd-title">${esc(code)}</h1>
      <p class="page-sub"><a href="#/rekap" class="back-link">&larr; Kembali ke SIMASET</a></p>
      <div id="rekapopd-body">${loadingBlock('Memuat…')}</div>
    </main>
    ${footer()}`;
  loadRekapOpd(code);
}

async function loadRekapOpd(code) {
  const el = document.getElementById('rekapopd-body');
  try {
    const r = await api('/api/tarik/rekap-opd?opd=' + encodeURIComponent(code));
    renderRekapOpdRows(r);
  } catch (err) {
    el.innerHTML = `<div class="error-state">Gagal memuat: ${esc(err.message)}</div>`;
  }
}

function renderRekapOpdRows(r) {
  const el = document.getElementById('rekapopd-body');
  const t = document.getElementById('rekapopd-title'); if (t) t.textContent = r.name;
  const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const byMonth = Array.from({ length: 12 }, () => []);
  r.items.forEach(it => { const i = new Date(it.BAST).getMonth(); if (i >= 0 && i < 12) byMonth[i].push(it); });
  const sections = byMonth.map((list, i) => {
    if (!list.length) return '';
    const rows = list.map(it => `<tr>
        <td>${esc(it.NamaBarang || '-')}</td>
        <td class="n">${esc(it.Satuan || '')}</td>
        <td class="n">${fmtID(Number(it.Jumlah) || 0)}</td>
        <td class="n">${fmtID(Number(it.Harga) || 0)}</td>
        <td class="n strong">${fmtID(Number(it.TotalHarga) || 0)}</td>
        <td class="n">${new Date(it.BAST).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}</td>
      </tr>`).join('');
    return `<div class="rekap-month">
      <div class="rekap-month-head"><h3>${MONTHS[i]}</h3><span class="rekap-month-total">${fmtID(r.months[i])}</span></div>
      <table class="rekap-items"><thead><tr><th>Barang</th><th class="n">Satuan</th><th class="n">Jml</th><th class="n">Harga</th><th class="n">Total</th><th class="n">Tgl BAST</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>`;
  }).join('');
  el.innerHTML = `
    <section class="card">
      <h2>Ringkasan per Bulan <span class="rekap-tag">TA 2026</span></h2>
      <div class="sum-table rekap">
        <table>
          <thead>
            <tr>
              <th class="saldo">Saldo Awal${r.saldo_src === 'th_lalu' ? ' <span class="saldo-tag">th</span>' : ''}</th>
              ${MLBL.map(m => `<th class="n m">${m}</th>`).join('')}
              <th class="n tin strong">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="n saldo">${fmtID(r.saldo_awal)}</td>
              ${r.months.map(v => `<td class="n">${fmtID(v)}</td>`).join('')}
              <td class="n strong tot-in">${fmtID(r.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="card">
      <h2>Rincian Saldo Berjalan <span class="rekap-count">${r.items.length} item</span></h2>
      ${sections || '<p class="page-sub">Tidak ada item saldo berjalan untuk TA 2026.</p>'}
    </section>`;
}

/* ---------- REKONSILIASI (sumber vs checklist, #/rekonsiliasi) ---------- */
async function renderRekonsiliasi() {
  app.innerHTML = header('rekonsiliasi') + `
    <main class="wrap">
      <h1 class="page-title">Rekonsiliasi</h1>
      <p class="page-sub">Membandingkan <b>SIMASET</b> (sumber resmi) dengan <b>Laporan Manual</b> (isian pengurus) per OPD. <b>Selisih</b> = SIMASET − Laporan Manual.</p>
      <section class="card admin-summary">
        <div class="sum-head">
          <h2>Rekonsiliasi <span class="rekap-tag">SIMASET vs Laporan Manual</span></h2>
          <div class="sum-actions">
            <input id="rek-search" class="search" type="search" placeholder="Cari nama / kode OPD…" aria-label="Cari OPD">
          </div>
        </div>
        <div id="rek-summary">${loadingBlock('Memuat…')}</div>
      </section>
    </main>
    ${footer()}`;
  document.getElementById('rek-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#rek-tbody tr').forEach(tr => { tr.style.display = tr.dataset.search.includes(q) ? '' : 'none'; });
  });
  loadRekonsiliasi();
}

async function loadRekonsiliasi() {
  const el = document.getElementById('rek-summary');
  try {
    const r = await api('/api/rekonsiliasi');
    renderRekonsiliasiRows(r);
  } catch (err) {
    el.innerHTML = `<div class="error-state">Gagal memuat: ${esc(err.message)}</div>`;
  }
}

function isCocok(d) {
  return d.sumber.saldo_awal === d.checklist.saldo_awal &&
    d.sumber.months.every((v, i) => v === d.checklist.months[i]);
}

function renderRekonsiliasiRows(r) {
  const el = document.getElementById('rek-summary');
  const sumRows = r.data.map(d => {
    const status = (d.has_sumber || d.has_checklist)
      ? (isCocok(d) ? '<span class="rek-st ok">Cocok</span>' : '<span class="rek-st bad">Beda</span>')
      : '<span class="rek-st none">Kosong</span>';
    return `<tr data-search="${esc((d.name + ' ' + d.code).toLowerCase())}">
      <td class="stick"><span class="opd-name">${esc(d.name)}</span><span class="sum-code">${esc(d.code)}</span></td>
      <td class="n">${fmtID(d.sumber.saldo_awal)}</td>
      <td class="n">${fmtID(d.checklist.saldo_awal)}</td>
      <td class="n">${fmtID(d.sumber.total)}</td>
      <td class="n">${fmtID(d.checklist.total)}</td>
      <td class="n strong ${(d.selisih.saldo_awal + d.selisih.total) !== 0 ? 'neg' : ''}">${fmtID(d.selisih.saldo_awal + d.selisih.total)}</td>
      <td class="st">${status}</td>
    </tr>`;
  }).join('');

  const beda = r.data
    .filter(d => !isCocok(d))
    .sort((a, b) => Math.abs(b.selisih.total) - Math.abs(a.selisih.total));
  const detail = beda.map((d, idx) => {
    const all = [
      { label: 'Saldo Awal', s: d.sumber.saldo_awal, c: d.checklist.saldo_awal, sel: d.selisih.saldo_awal },
      ...MLBL.map((m, i) => ({ label: m, s: d.sumber.months[i], c: d.checklist.months[i], sel: d.selisih.months[i] })),
      { label: 'Total', s: d.sumber.saldo_awal + d.sumber.total, c: d.checklist.saldo_awal + d.checklist.total, sel: d.selisih.saldo_awal + d.selisih.total }
    ];
    const diffCount = all.filter(row => row.label !== 'Total' && row.sel !== 0).length;
    const rows = all.map(row => `<tr class="${row.sel !== 0 ? 'diff' : ''}">
      <td class="lbl">${row.label}</td>
      <td class="n">${fmtID(row.s)}</td>
      <td class="n">${fmtID(row.c)}</td>
      <td class="n ${row.sel !== 0 ? 'neg' : ''}">${fmtID(row.sel)}</td>
    </tr>`).join('');
    return `<details class="rek-detail"${idx < 3 ? ' open' : ''}>
      <summary>
        <span class="rek-d-name">${esc(d.name)}</span>
        <span class="sum-code">${esc(d.code)}</span>
        <span class="rek-d-badge">${diffCount} beda</span>
        <span class="rek-d-sel${(d.selisih.saldo_awal + d.selisih.total) !== 0 ? ' neg' : ''}">Selisih ${fmtID(d.selisih.saldo_awal + d.selisih.total)}</span>
        <span class="rek-d-chev" aria-hidden="true"></span>
      </summary>
      <div class="rek-d-body">
        <table class="rek-table">
          <thead><tr><th>Komponen</th><th class="n">SIMASET</th><th class="n">Laporan Manual</th><th class="n">Selisih</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </details>`;
  }).join('');

  el.innerHTML = `
    <div class="summary-stat"><b>${beda.length}</b> dari ${r.data.length} OPD belum cocok dengan SIMASET</div>
    <div class="sum-table rek">
      <table>
        <thead><tr>
          <th class="stick">OPD</th>
          <th class="n">Saldo Awal 2026 <span class="th-sub">SIMASET</span></th>
          <th class="n">Saldo Awal 2026 <span class="th-sub">Laporan Manual</span></th>
          <th class="n">Penerimaan <span class="th-sub">SIMASET</span></th>
          <th class="n">Penerimaan <span class="th-sub">Laporan Manual</span></th>
          <th class="n strong">Selisih</th>
          <th>Status</th>
        </tr></thead>
        <tbody id="rek-tbody">${sumRows}</tbody>
      </table>
    </div>
    ${beda.length
      ? `<div class="rek-detail-h">Rincian yang Belum Cocok <span class="rek-count">${beda.length} OPD</span><span class="rek-toggles"><button type="button" id="rek-openall">Buka semua</button><button type="button" id="rek-closeall">Tutup semua</button></span></div>` + detail
      : '<p class="rekap-note">Semua OPD sudah cocok dengan SIMASET.</p>'}`;
  const openAll = el.querySelector('#rek-openall');
  const closeAll = el.querySelector('#rek-closeall');
  if (openAll) openAll.addEventListener('click', () => el.querySelectorAll('.rek-detail').forEach(d => { d.open = true; }));
  if (closeAll) closeAll.addEventListener('click', () => el.querySelectorAll('.rek-detail').forEach(d => { d.open = false; }));
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
    <main class="wrap admin admin-auth">
      <div class="card login-card">
        <div class="login-head">
          <span class="login-badge">ADMIN</span>
          <h1 class="login-title">Rekonsiliasi <span>SIMASET</span></h1>
          <p class="login-sub">Area khusus admin. Isi <b>Saldo Akhir SIMASET 2026</b> per OPD, lalu cocokkan dengan saldo akhir dari Laporan Manual.</p>
        </div>
        <form id="admin-login-form" class="login-form">
          <div class="login-field">
            <label class="field-label" for="al-user">Username</label>
            <input type="text" id="al-user" autocomplete="username" required placeholder="admin">
          </div>
          <div class="login-field">
            <label class="field-label" for="al-pass">Password</label>
            <input type="password" id="al-pass" autocomplete="current-password" required placeholder="••••••••••">
          </div>
          <button type="submit" class="btn primary login-btn">Masuk</button>
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
          <p class="page-sub">Isi <b>Saldo Akhir SIMASET 2026</b> per OPD. Kolom <b>Selisih</b> terhitung otomatis terhadap Saldo Akhir Tahunan. Simpan per OPD atau semua sekaligus.</p>
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
              <th class="n">Saldo Akhir Tahunan</th>
              <th class="n">Saldo Akhir SIMASET 2026</th>
              <th class="n">Selisih</th>
              <th class="n">Aksi</th>
            </tr></thead>
            <tbody id="admin-tbody"><tr class="loading-row"><td colspan="5"><span class="spinner"></span>Memuat…</td></tr></tbody>
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
        <td class="n"><input type="text" inputmode="decimal" class="num admin-inp" data-code="${esc(r.code)}" value="${fmtID(r.opname_simaset)}" aria-label="Saldo Akhir SIMASET 2026 ${esc(r.name)}"></td>
        <td class="n selisih" data-selisih="${esc(r.code)}">${fmtID(r.selisih)}</td>
        <td class="n"><button type="button" class="btn ghost admin-save-btn" data-code="${esc(r.code)}">Simpan</button></td>
      </tr>`).join('');
    document.querySelectorAll('#admin-tbody .admin-inp').forEach(inp => {
      inp.addEventListener('input', () => { inp.value = liveFormat(inp.value); updateAdminSelisih(inp.dataset.code); });
      inp.addEventListener('blur', () => { inp.value = fmtID(parseMoney(inp.value)); updateAdminSelisih(inp.dataset.code); });
    });
    document.querySelectorAll('#admin-tbody .admin-save-btn').forEach(btn => {
      btn.addEventListener('click', () => saveOne(btn.dataset.code));
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
async function saveOne(code) {
  const btn = document.querySelector(`#admin-tbody .admin-save-btn[data-code="${code}"]`);
  const inp = document.querySelector(`#admin-tbody .admin-inp[data-code="${code}"]`);
  if (!btn || !inp) return;
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  try {
    await api('/api/admin/opname/' + encodeURIComponent(code), { method: 'PUT', body: JSON.stringify({ opname_simaset: round2(parseMoney(inp.value)) }) });
    btn.textContent = 'Tersimpan ✓'; btn.classList.add('ok');
    setTimeout(() => { btn.textContent = 'Simpan'; btn.classList.remove('ok'); btn.disabled = false; }, 1500);
  } catch (err) {
    btn.textContent = 'Gagal'; btn.classList.add('err');
    setTimeout(() => { btn.textContent = 'Simpan'; btn.classList.remove('err'); btn.disabled = false; }, 1500);
  }
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
