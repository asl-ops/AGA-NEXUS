#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const XLSX = require('xlsx');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, writeBatch, query, where } = require('firebase/firestore');
const { recalculateEconomicSummaries } = require('./lib/economic-summary-recalc.cjs');

const TARGET_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo',
  authDomain: 'gestor-de-expedientes-pro.firebaseapp.com',
  projectId: 'gestor-de-expedientes-pro',
  storageBucket: 'gestor-de-expedientes-pro.firebasestorage.app',
  messagingSenderId: '266201334385',
  appId: '1:266201334385:web:41e33a97d264660de951d0',
};

const DEFAULT_EXCEL_PATH =
  '/Users/antoniosanchez/Library/Mobile Documents/com~apple~CloudDocs/AATRASPASOS/SALDOS CONTABLES DEPURADOS.xlsx';
const CONFIRM_TOKEN = 'IMPORT_SALDOS_CONTABLES_DEPURADOS';
const BATCH_SIZE = 300;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return clean(value)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeCuenta(value) {
  return clean(value).replace(/[^\d]/g, '');
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(2));
  const txt = clean(value);
  if (!txt) return NaN;
  const normalized = txt.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return NaN;
  return Number(n.toFixed(2));
}

function slug(value) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function parseArgValue(args, name, defaultValue = '') {
  const idx = args.findIndex((x) => x === name);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || defaultValue;
}

function hasArg(args, name) {
  return args.includes(name);
}

function sanitizeUndefinedDeep(value) {
  if (Array.isArray(value)) return value.map(sanitizeUndefinedDeep);
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      if (v !== undefined) out[k] = sanitizeUndefinedDeep(v);
    });
    return out;
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function commitInChunks(db, operations) {
  async function commitWithRetry(batch, chunkIndex) {
    const MAX_RETRIES = 8;
    let retry = 0;
    while (true) {
      try {
        await batch.commit();
        return;
      } catch (error) {
        const message = String(error?.message || error);
        const retryable =
          message.includes('RESOURCE_EXHAUSTED') ||
          message.includes('resource-exhausted') ||
          message.includes('deadline-exceeded') ||
          message.includes('unavailable');
        if (!retryable || retry >= MAX_RETRIES) throw error;
        retry += 1;
        const backoff = Math.min(20000, 500 * 2 ** retry);
        console.warn(`⚠️ Reintento chunk ${chunkIndex} (${retry}/${MAX_RETRIES}) en ${backoff}ms`);
        await wait(backoff);
      }
    }
  }

  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = operations.slice(i, i + BATCH_SIZE);
    const chunkIndex = Math.floor(i / BATCH_SIZE) + 1;
    chunk.forEach((op) => batch.set(op.ref, op.data, { merge: true }));
    await commitWithRetry(batch, chunkIndex);
    if (chunkIndex % 10 === 0) {
      console.log(`   ✓ chunks confirmados: ${Math.min(i + BATCH_SIZE, operations.length)}/${operations.length}`);
    }
    await wait(60);
  }
}

async function run() {
  const args = process.argv.slice(2);
  const execute = hasArg(args, '--execute');
  const skipRecalc = hasArg(args, '--skip-recalc');
  const fullSnapshot = hasArg(args, '--full-snapshot');
  const confirm = parseArgValue(args, '--confirm');
  const excelPath = parseArgValue(args, '--excel', DEFAULT_EXCEL_PATH);
  const sheetNameArg = parseArgValue(args, '--sheet', '');

  if (!fs.existsSync(excelPath)) throw new Error(`No existe el archivo Excel: ${excelPath}`);

  const wb = XLSX.readFile(excelPath, { raw: true, cellDates: false });
  const sheetName = sheetNameArg
    ? wb.SheetNames.find((s) => normalizeText(s) === normalizeText(sheetNameArg)) || wb.SheetNames[0]
    : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

  const app =
    getApps().find((a) => a.name === 'target-expedientes-pro-saldos-depurados') ||
    initializeApp(TARGET_FIREBASE_CONFIG, 'target-expedientes-pro-saldos-depurados');
  const db = getFirestore(app);

  const [clientsSnap, existingBalancesSnap] = await Promise.all([
    getDocs(collection(db, 'clients')),
    getDocs(collection(db, 'economicBalances')),
  ]);

  const clientsByCuenta = new Map();
  const existingById = new Map();
  clientsSnap.docs.forEach((d) => {
    const data = d.data();
    const cuenta = normalizeCuenta(data.cuentaContable || '');
    if (cuenta && !clientsByCuenta.has(cuenta)) clientsByCuenta.set(cuenta, { id: d.id, ...data });
  });
  existingBalancesSnap.docs.forEach((d) => {
    existingById.set(d.id, { id: d.id, ...d.data() });
  });

  const now = new Date().toISOString();
  const balances = [];
  const changedClientIds = new Set();
  const seenBalanceIds = new Set();
  let skipped = 0;
  let parseErrors = 0;

  rows.forEach((row, idx) => {
    const cuentaRaw = row.cuentaContable ?? row.Cuenta ?? row.cuenta ?? row.CuentaContable;
    const titulo = clean(row.titulo ?? row.Titulo ?? row['Título'] ?? row.nombre ?? '');
    const saldoRaw = row.saldoActual ?? row.SaldoActual ?? row['Saldo actual'] ?? row.saldo;

    const cuentaContable = normalizeCuenta(cuentaRaw);
    if (!cuentaContable) {
      skipped += 1;
      return;
    }

    const saldoActual = parseNumber(saldoRaw);
    if (!Number.isFinite(saldoActual)) {
      parseErrors += 1;
      skipped += 1;
      return;
    }

    const clientMatch = clientsByCuenta.get(cuentaContable);
    const id = `saldo_${slug(cuentaContable)}_${idx + 1}`;

    const balanceCore = {
      id,
      source: 'SALDOS_CONTABLES_DEPURADOS',
      sourceSheet: sheetName,
      clientId: clientMatch?.id || null,
      clientName: clean(clientMatch?.nombre || titulo || ''),
      cuentaContable,
      titulo,
      saldoActual,
      updatedAt: now,
      createdAt: now,
    };
    const fp = fingerprint({
      cuentaContable: balanceCore.cuentaContable,
      titulo: balanceCore.titulo,
      saldoActual: balanceCore.saldoActual,
      clientId: balanceCore.clientId,
      source: balanceCore.source,
    });
    balances.push({
      ...balanceCore,
      __fp: fp,
      softDeleted: false,
      isActive: true,
      deletedAt: null,
      deletedBy: null,
    });
    seenBalanceIds.add(id);
  });

  const report = {
    executedAt: now,
    dryRun: !execute,
    excelPath,
    sheetName,
    sourceRows: rows.length,
    transformedBalances: balances.length,
    skippedRows: skipped,
    parseErrors,
    withClientId: balances.filter((b) => !!b.clientId).length,
    targetBeforeBalances: existingBalancesSnap.size,
    sample: balances[0] || null,
    mode: fullSnapshot ? 'full-snapshot' : 'incremental',
    softDeleted: 0,
    unchangedRows: 0,
    changedRows: 0,
    clientsChanged: 0,
  };

  const reportPath = path.resolve('/tmp', `import_saldos_contables_depurados_report_${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nImportador SALDOS CONTABLES DEPURADOS');
  console.log('Modo importación:', fullSnapshot ? 'FULL SNAPSHOT (soft-delete ausentes)' : 'INCREMENTAL');
  console.log('Excel:', excelPath);
  console.log('Hoja:', sheetName);
  console.log('Filas origen:', rows.length, '| transformadas:', balances.length, '| omitidas:', skipped);
  console.log('Saldos con clientId:', report.withClientId);
  if (fullSnapshot) console.log('Saldos soft-delete:', report.softDeleted);
  console.log('Report:', reportPath);

  if (!execute) {
    console.log('\nDRY-RUN: no se escribieron datos.');
    console.log(
      `Para ejecutar: node scripts/import-saldos-contables-depurados.cjs --execute --confirm ${CONFIRM_TOKEN}` +
      (fullSnapshot ? ' --full-snapshot' : '')
    );
    return;
  }

  if (confirm !== CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Debes usar --confirm ${CONFIRM_TOKEN}`);
  }

  const operations = [];
  balances.forEach((b) => {
    const prev = existingById.get(b.id);
    const oldFp = clean(prev?.__fp || '');
    const wasSoftDeleted = prev?.softDeleted === true || prev?.isActive === false;
    const prevClientId = clean(prev?.clientId || '');
    if (oldFp === b.__fp && !wasSoftDeleted) {
      report.unchangedRows += 1;
      return;
    }
    operations.push({
      ref: doc(db, 'economicBalances', b.id),
      data: sanitizeUndefinedDeep(b),
    });
    report.changedRows += 1;
    if (b.clientId) changedClientIds.add(b.clientId);
    if (prevClientId) changedClientIds.add(prevClientId);
  });

  if (fullSnapshot) {
    const existingSourceSnap = await getDocs(
      query(collection(db, 'economicBalances'), where('source', '==', 'SALDOS_CONTABLES_DEPURADOS'))
    );
    existingSourceSnap.docs.forEach((d) => {
      if (!seenBalanceIds.has(d.id)) {
        const prev = d.data();
        if (!(prev.softDeleted === true || prev.isActive === false)) {
          operations.push({
            ref: doc(db, 'economicBalances', d.id),
            data: sanitizeUndefinedDeep({
              softDeleted: true,
              deletedAt: now,
              deletedBy: 'import-saldos-contables-depurados--full-snapshot',
              isActive: false,
              updatedAt: now,
            }),
          });
          report.softDeleted += 1;
          report.changedRows += 1;
          const affectedClientId = clean(prev.clientId || '');
          if (affectedClientId) changedClientIds.add(affectedClientId);
        }
      }
    });
  }
  report.clientsChanged = changedClientIds.size;
  report.changedClientIds = Array.from(changedClientIds).sort();

  await commitInChunks(db, operations);

  let recalc = null;
  if (!skipRecalc && changedClientIds.size > 0) {
    console.log(`\nRecalculando sumarios económicos para ${changedClientIds.size} clientes realmente cambiados...`);
    recalc = await recalculateEconomicSummaries(db, {
      clientIds: Array.from(changedClientIds),
      includeYearly: true,
      logPrefix: '[RECALC SALDOS]',
      writeTimingLog: true,
    });
    report.recalc = recalc;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log('Recalc report:', recalc.reportPath || '(sin ruta)');
  }

  const afterBalancesSnap = await getDocs(collection(db, 'economicBalances'));
  console.log('\nImportación completada.');
  console.log('economicBalances antes:', existingBalancesSnap.size, '| después:', afterBalancesSnap.size);
  if (recalc) {
    console.log(
      `Recalc tiempo total: ${(recalc.totalMs / 1000).toFixed(2)}s | avg: ${(recalc.avgMsPerClient / 1000).toFixed(2)}s/cliente | p95: ${(recalc.p95MsPerClient / 1000).toFixed(2)}s`
    );
  }
}

run().catch((error) => {
  console.error('\nError importando SALDOS CONTABLES DEPURADOS:', error.message || error);
  process.exit(1);
});
