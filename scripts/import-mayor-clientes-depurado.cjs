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
  '/Users/antoniosanchez/Library/Mobile Documents/com~apple~CloudDocs/AATRASPASOS/MAYOR DE CLIENTES DEPURADO.xlsx';
const CONFIRM_TOKEN = 'IMPORT_MAYOR_CLIENTES_DEPURADO';
const COLLECTION_NAME = 'economicLedgerEntries';
const BATCH_SIZE = 250;

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

function slug(value) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(2));
  const txt = clean(value);
  if (!txt || txt === '-') return 0;
  const normalized = txt.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function parseDate(value) {
  if (!value && value !== 0) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const y = String(parsed.y).padStart(4, '0');
    const m = String(parsed.m).padStart(2, '0');
    const d = String(parsed.d).padStart(2, '0');
    return `${y}-${m}-${d}T00:00:00.000Z`;
  }
  const txt = clean(value);
  if (!txt) return null;

  const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`;

  const es4 = txt.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (es4) {
    const d = String(Number(es4[1])).padStart(2, '0');
    const m = String(Number(es4[2])).padStart(2, '0');
    const y = es4[3];
    return `${y}-${m}-${d}T00:00:00.000Z`;
  }

  const es2 = txt.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (es2) {
    const d = String(Number(es2[1])).padStart(2, '0');
    const m = String(Number(es2[2])).padStart(2, '0');
    const yy = Number(es2[3]);
    const y = yy >= 70 ? `19${String(yy).padStart(2, '0')}` : `20${String(yy).padStart(2, '0')}`;
    return `${y}-${m}-${d}T00:00:00.000Z`;
  }

  const dt = new Date(txt);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  return null;
}

function isAccountHeader(text) {
  return /^CUENTA\s+\d+/i.test(clean(text));
}

function parseAccountHeader(text) {
  const t = clean(text);
  const m = t.match(/^CUENTA\s+(\d+)\s+(.*)$/i);
  if (!m) return { cuentaContable: '', titulo: '' };
  return {
    cuentaContable: normalizeCuenta(m[1]),
    titulo: clean(m[2]),
  };
}

function isMovementHeaderRow(row) {
  return normalizeText(row[0]) === 'FECHA' && normalizeText(row[1]) === 'ASIENTO';
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

function parseArgValue(args, name, defaultValue = '') {
  const idx = args.findIndex((x) => x === name);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || defaultValue;
}

function hasArg(args, name) {
  return args.includes(name);
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
    if (chunkIndex % 50 === 0) {
      console.log(`   ✓ chunks confirmados: ${Math.min(i + BATCH_SIZE, operations.length)}/${operations.length}`);
    }
    await wait(40);
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
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

  const app =
    getApps().find((a) => a.name === 'target-expedientes-pro-mayor-clientes') ||
    initializeApp(TARGET_FIREBASE_CONFIG, 'target-expedientes-pro-mayor-clientes');
  const db = getFirestore(app);

  const [clientsSnap, existingLedgerSnap] = await Promise.all([
    getDocs(collection(db, 'clients')),
    getDocs(collection(db, COLLECTION_NAME)),
  ]);

  const clientsByCuenta = new Map();
  const existingById = new Map();
  clientsSnap.docs.forEach((d) => {
    const data = d.data();
    const cuenta = normalizeCuenta(data.cuentaContable || '');
    if (cuenta && !clientsByCuenta.has(cuenta)) clientsByCuenta.set(cuenta, { id: d.id, ...data });
  });
  existingLedgerSnap.docs.forEach((d) => {
    existingById.set(d.id, { id: d.id, ...d.data() });
  });

  const entries = [];
  const changedClientIds = new Set();
  const seenEntryIds = new Set();
  const now = new Date().toISOString();
  let currentCuenta = '';
  let currentTitulo = '';
  let currentSaldoAnterior = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const c0 = clean(row[0]);
    if (!c0) continue;

    if (isAccountHeader(c0)) {
      const parsed = parseAccountHeader(c0);
      currentCuenta = parsed.cuentaContable;
      currentTitulo = parsed.titulo;
      currentSaldoAnterior = parseNumber(row[8]);
      continue;
    }

    if (isMovementHeaderRow(row)) continue;
    if (normalizeText(c0) === 'LIBRO MAYOR') continue;

    // Salta subtotales/lineas de cierre
    const descCell = clean(row[5]);
    const descNorm = normalizeText(descCell);
    if (
      descNorm.startsWith('TOTAL PERIODO') ||
      descNorm.startsWith('TOTAL CUENTA') ||
      descNorm === 'SALDO ANTERIOR'
    ) {
      continue;
    }

    const fecha = parseDate(row[0]);
    const asiento = clean(row[1]);
    const documento = clean(row[2]);
    const diario = clean(row[3]);
    const libro = clean(row[4]);
    const descripcion = descCell;
    const debe = parseNumber(row[6]);
    const haber = parseNumber(row[7]);
    const saldo = parseNumber(row[8]);

    if (!currentCuenta || !fecha) {
      skipped += 1;
      continue;
    }

    const clientMatch = clientsByCuenta.get(currentCuenta);
    const id = `mayor_${slug(currentCuenta)}_${slug(fecha)}_${slug(asiento || documento || `row_${i + 1}`)}_${i + 1}`;

    const entryCore = {
      id,
      source: 'MAYOR_CLIENTES_DEPURADO',
      sourceSheet: sheetName,
      rowNumber: i + 1,
      clientId: clientMatch?.id || null,
      clientName: clean(clientMatch?.nombre || currentTitulo || ''),
      cuentaContable: currentCuenta,
      tituloCuenta: currentTitulo,
      fecha,
      asiento,
      documento,
      diario,
      libro,
      descripcion,
      debe,
      haber,
      saldo,
      saldoAnteriorCuenta: currentSaldoAnterior,
      updatedAt: now,
      createdAt: now,
    };
    const fp = fingerprint({
      cuentaContable: entryCore.cuentaContable,
      fecha: entryCore.fecha,
      asiento: entryCore.asiento,
      documento: entryCore.documento,
      descripcion: entryCore.descripcion,
      debe: entryCore.debe,
      haber: entryCore.haber,
      saldo: entryCore.saldo,
      clientId: entryCore.clientId,
      source: entryCore.source,
    });
    entries.push({
      ...entryCore,
      __fp: fp,
      softDeleted: false,
      isActive: true,
      deletedAt: null,
      deletedBy: null,
    });
    seenEntryIds.add(id);
  }

  const report = {
    executedAt: now,
    dryRun: !execute,
    excelPath,
    sheetName,
    sourceRows: rows.length,
    transformedEntries: entries.length,
    skippedRows: skipped,
    withClientId: entries.filter((e) => !!e.clientId).length,
    distinctCuentas: new Set(entries.map((e) => e.cuentaContable)).size,
    targetBeforeEntries: existingLedgerSnap.size,
    sample: entries[0] || null,
    mode: fullSnapshot ? 'full-snapshot' : 'incremental',
    softDeleted: 0,
    unchangedRows: 0,
    changedRows: 0,
    clientsChanged: 0,
  };

  const reportPath = path.resolve('/tmp', `import_mayor_clientes_depurado_report_${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nImportador MAYOR DE CLIENTES DEPURADO');
  console.log('Modo importación:', fullSnapshot ? 'FULL SNAPSHOT (soft-delete ausentes)' : 'INCREMENTAL');
  console.log('Excel:', excelPath);
  console.log('Hoja:', sheetName);
  console.log('Filas origen:', rows.length, '| apuntes:', entries.length, '| omitidas:', skipped);
  console.log('Apuntes con clientId:', report.withClientId, '| cuentas distintas:', report.distinctCuentas);
  if (fullSnapshot) console.log('Apuntes soft-delete:', report.softDeleted);
  console.log('Report:', reportPath);

  if (!execute) {
    console.log('\nDRY-RUN: no se escribieron datos.');
    console.log(
      `Para ejecutar: node scripts/import-mayor-clientes-depurado.cjs --execute --confirm ${CONFIRM_TOKEN}` +
      (fullSnapshot ? ' --full-snapshot' : '')
    );
    return;
  }

  if (confirm !== CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Debes usar --confirm ${CONFIRM_TOKEN}`);
  }

  const operations = [];
  entries.forEach((e) => {
    const prev = existingById.get(e.id);
    const oldFp = clean(prev?.__fp || '');
    const wasSoftDeleted = prev?.softDeleted === true || prev?.isActive === false;
    const prevClientId = clean(prev?.clientId || '');
    if (oldFp === e.__fp && !wasSoftDeleted) {
      report.unchangedRows += 1;
      return;
    }
    operations.push({
      ref: doc(db, COLLECTION_NAME, e.id),
      data: sanitizeUndefinedDeep(e),
    });
    report.changedRows += 1;
    if (e.clientId) changedClientIds.add(e.clientId);
    if (prevClientId) changedClientIds.add(prevClientId);
  });

  if (fullSnapshot) {
    const existingSourceSnap = await getDocs(
      query(collection(db, COLLECTION_NAME), where('source', '==', 'MAYOR_CLIENTES_DEPURADO'))
    );
    existingSourceSnap.docs.forEach((d) => {
      if (!seenEntryIds.has(d.id)) {
        const prev = d.data();
        if (!(prev.softDeleted === true || prev.isActive === false)) {
          operations.push({
            ref: doc(db, COLLECTION_NAME, d.id),
            data: sanitizeUndefinedDeep({
              softDeleted: true,
              deletedAt: now,
              deletedBy: 'import-mayor-clientes-depurado--full-snapshot',
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
      logPrefix: '[RECALC MAYOR]',
      writeTimingLog: true,
    });
    report.recalc = recalc;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log('Recalc report:', recalc.reportPath || '(sin ruta)');
  }

  const afterLedgerSnap = await getDocs(collection(db, COLLECTION_NAME));
  console.log('\nImportación completada.');
  console.log(`${COLLECTION_NAME} antes:`, existingLedgerSnap.size, '| después:', afterLedgerSnap.size);
  if (recalc) {
    console.log(
      `Recalc tiempo total: ${(recalc.totalMs / 1000).toFixed(2)}s | avg: ${(recalc.avgMsPerClient / 1000).toFixed(2)}s/cliente | p95: ${(recalc.p95MsPerClient / 1000).toFixed(2)}s`
    );
  }
}

run().catch((error) => {
  console.error('\nError importando MAYOR DE CLIENTES DEPURADO:', error.message || error);
  process.exit(1);
});
