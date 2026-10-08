# Checklist Persediaan 2026

Aplikasi web sederhana untuk checklist persediaan barang OPD tahun 2026.

> **Tujuan**: mempermudah **penyandingan (rekonsiliasi) data persediaan** OPD dengan aplikasi **SIMASET**. Pengurus mencatat total penerimaan per bulan & total pengeluaran per semester, lalu mencocokkannya dengan data di SIMASET.

- **Penerimaan**: dicatat **per bulan** (Januari – Desember), berupa **total** penerimaan bulan itu.
- **Pengeluaran**: dicatat **per semester** (Semester 1, Semester 2), berupa **total** pengeluaran semester itu.
- **Saldo Awal 2026**: stok di awal tahun, diisi oleh pengurus.
- **Saldo Awal Juli**: stok di awal semester 2, diisi oleh pengurus.
- **Total penerimaan** per semester: S1 = Jan–Jun, S2 = Jul–Des (otomatis).
- **Pengeluaran tahunan** = S1 + S2 (otomatis).
- **Stock opname** dihitung otomatis (di menu Statistik):
  - Stock Sem 1 = saldo awal + penerimaan Jan–Jun − pengeluaran S1
  - Stock Sem 2 = saldo awal Juli + penerimaan Jul–Des − pengeluaran S2
  - Stock Tahunan = saldo awal + penerimaan Jan–Des − pengeluaran tahunan (S1+S2)
- **Rekonsiliasi SIMASET**: admin mengisi **Opname Simaset 2026** per OPD (di halaman admin tersembunyi), lalu **Selisih** dihitung otomatis = Opname Simaset − Stock Opname Tahunan (jika sama = 0).
- Setiap **pengurus barang** membuka satu link, memilih **OPD-nya**, lalu mengisi total penerimaan per bulan dan total pengeluaran per semester. Rekap seluruh OPD ada di menu **Statistik**.

> Catatan: isian **tidak per barang**. Tiap OPD hanya mengisi **total** per bulan / per semester.

## Alur

1. Publikasikan link domain kamu (mis. `https://domainkamu.com`).
2. Pengurus barang membuka link → memilih OPD-nya → mengisi 12 total penerimaan (per bulan) + 2 total pengeluaran (per semester) → **Simpan Checklist**.
3. Buka menu **Statistik** → rekap seluruh OPD: penerimaan per bulan, pengeluaran per semester, stock opname, dan rekonsiliasi SIMASET.

## Admin — Rekonsiliasi SIMASET

Halaman admin **tersembunyi** — tidak ada link di menu. Akses dengan mengetik URL `#/admin` (mis. `https://domainkamu.com/#/admin`):

- **Login** dengan username & password dari `.env` (`ADMIN_USER`, `ADMIN_PASS`).
- Setelah masuk, admin mengisi **Opname Simaset 2026** per OPD (hasil opname di SIMASET).
- **Selisih** terhitung otomatis = Opname Simaset 2026 − Stock Opname Tahunan. Jika sama, selisih = 0.
- Hasilnya juga tampil di menu **Statistik** (2 kolom baru: Opname Simaset 2026 & Selisih).

> Sesi admin = cookie token (HttpOnly) berumur 12 jam, ditandatangani dengan `ADMIN_SECRET`. Ganti `ADMIN_PASS` & `ADMIN_SECRET` dengan nilai kuat sebelum deploy.

## Menjalankan (lokal)

```bash
npm install
cp .env.example .env    # lalu isi kredensial Postgres di .env
npm start               # http://localhost:3000
```

Aplikasi membaca koneksi dari `.env` (`DATABASE_URL`) serta kredensial admin (`ADMIN_USER`, `ADMIN_PASS`, `ADMIN_SECRET`). Tabel `entries` dibuat otomatis di database kamu saat server mulai.

## Men-deploy ke domain

Aplikasi Node.js standar (Express + PostgreSQL). Deploy ke hosting apa pun yang menjalankan Node (VPS, Render, Railway, dsb.):

1. Upload/kopi seluruh folder proyek.
2. `npm install`
3. Buat file `.env` berisi `DATABASE_URL` (jangan commit `.env` ke repo — sudah di-.gitignore).
4. Jalankan dengan `npm start` (atau proses manager seperti PM2). Server membaca `PORT` dari environment.
5. Arahkan domain ke server tersebut.

> Catatan: menu publik (Beranda, Checklist, Statistik) tidak butuh login. Halaman **admin** (`#/admin`) terlindungi login. Ganti `ADMIN_PASS` & `ADMIN_SECRET` dengan nilai kuat sebelum dipublikasikan.

## Struktur

```
server.js          Express + pg (PostgreSQL) — API + statis
.env               kredensial Postgres (DI-GITIGNORE, jangan di-commit)
.env.example       template .env
OPDHerman.json     daftar 38 OPD
public/
  index.html       shell SPA
  styles.css       desain neo-brutalism
  app.js           logika SPA (hash routing)
```

## API

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/opds` | daftar OPD |
| GET | `/api/opds/:code` | isian satu OPD |
| PUT | `/api/opds/:code` | simpan isian satu OPD |
| GET | `/api/statistik` | rekap seluruh OPD (per bulan & per semester) |
| POST | `/api/admin/login` | login admin (set cookie sesi) |
| POST | `/api/admin/logout` | keluar admin |
| GET | `/api/admin/me` | status login admin |
| GET | `/api/admin/rekonsiliasi` | rekap rekonsiliasi (perlu login) |
| PUT | `/api/admin/opname/:code` | simpan Opname Simaset 2026 satu OPD (perlu login) |

## Desain

Neo-brutalism: border tebal + hard offset shadow (bukan shadow lembut), warna solid flat, sudut kecil, tipografi berat (Archivo Black + Manrope). Warna berfungsi sebagai hierarki: kuning = penerimaan, pink = pengeluaran, biru = fokus keyboard.
