// Koneksi ke sumber data MSSQL (aplikasi cek-penerimaan / SIMASET).
// OPSIONAL: kalau env MSSQL_* tidak di-set, endpoint /api/tarik/* balas 503
// dan server tetap jalan (Postgres tetap sumber data utama app ini).
const sql = require('mssql');

let pool = null;

function isMssqlConfigured() {
  return !!(process.env.MSSQL_SERVER && process.env.MSSQL_DATABASE && process.env.MSSQL_UID && process.env.MSSQL_PWD);
}

async function getMssqlPool() {
  if (!pool) {
    pool = await sql.connect({
      server: process.env.MSSQL_SERVER,
      database: process.env.MSSQL_DATABASE,
      user: process.env.MSSQL_UID,
      password: process.env.MSSQL_PWD,
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      requestTimeout: 60000,
    });
  }
  return pool;
}

module.exports = { isMssqlConfigured, getMssqlPool };
