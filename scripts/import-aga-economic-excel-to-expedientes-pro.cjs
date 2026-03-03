#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, writeBatch } = require('firebase/firestore');

const TARGET_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo',
  authDomain: 'gestor-de-expedientes-pro.firebaseapp.com',
  projectId: 'gestor-de-expedientes-pro',
  storageBucket: 'gestor-de-expedientes-pro.firebasestorage.app',
  messagingSenderId: '266201334385',
  appId: '1:266201334385:web:41e33a97d264660de951d0',
};

const DEFAULT_EXCEL_PATH =
  '/Users/antoniosanchez/AaaMisaplicaciones/AGA-CCS-GI/AGA VISTA 360 CLIENTE.xlsx';
const CONFIRM_TOKEN = 'IMPORT_AGA_ECONOMIC_EXCEL';
const BATCH_SIZE = 200;
const INTER_BATCH_DELAY_MS = 100;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toUpperCase().replace(/[\s.\-_/]/g, '');
}

function nowIso() {
  return new Date().toISOString();
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const txt = clean(value).replace(/\./g, '').replace(',', '.');
  const n = Number(txt);
  return Number.isFinite(n) ? n : 0;
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
  const ddmmyyyy = txt.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (ddmmyyyy) {
    const d = String(Number(ddmmyyyy[1])).padStart(2, '0');
    const m = String(Number(ddmmyyyy[2])).padStart(2, '0');
    const y = ddmmyyyy[3];
    return `${y}-${m}-${d}T00:00:00.000Z`;
  }
  const dt = new Date(txt);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  return null;
}

function parseStatus(rawStatus) {
  const s = clean(rawStatus).toLowerCase();
  if (s.includes('pagad') || s.includes('cobrad')) return 'paid';
  if (s.includes('vencid') || s.includes('impag') || s.includes('devuelt')) return 'overdue';
  return 'pending';
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

function parseArgValue(args, name, defaultValue = '') {
  const idx = args.findIndex((x) => x === name);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || defaultValue;
}

function hasArg(args, name) {
  return args.includes(name);
}

async function commitInChunks(ops, db) {
  async function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
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
        const backoff = Math.min(15000, 400 * 2 ** retry);
        console.warn(`⚠️ Reintento chunk ${chunkIndex} (retry ${retry}/${MAX_RETRIES}) en ${backoff}ms`);
        await wait(backoff);
      }
    }
  }

  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const chunkIndex = Math.floor(i / BATCH_SIZE) + 1;
    const batch = writeBatch(db);
    ops.slice(i, i + BATCH_SIZE).forEach((op) => batch.set(op.ref, op.data, { merge: true }));
    await commitWithRetry(batch, chunkIndex);
    if (chunkIndex % 20 === 0) {
      console.log(`   ✓ chunks confirmados: ${chunkIndex} (${Math.min(i + BATCH_SIZE, ops.length)}/${ops.length} ops)`);
    }
    await wait(INTER_BATCH_DELAY_MS);
  }
}

async function run() {
  const args = process.argv.slice(2);
  const execute = hasArg(args, '--execute');
  const confirm = parseArgValue(args, '--confirm');
  const excelPath = parseArgValue(args, '--excel', DEFAULT_EXCEL_PATH);

  if (!fs.existsSync(excelPath)) {
    throw new Error(`No existe el Excel: ${excelPath}`);
  }

  const targetApp =
    getApps().find((a) => a.name === 'target-expedientes-pro-economic') ||
    initializeApp(TARGET_FIREBASE_CONFIG, 'target-expedientes-pro-economic');
  const db = getFirestore(targetApp);

  const [clientsSnap, existingEcoInvSnap, existingEcoBalanceSnap] = await Promise.all([
    getDocs(collection(db, 'clients')),
    getDocs(collection(db, 'economicInvoices')),
    getDocs(collection(db, 'economicBalances')),
  ]);

  const clients = clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byDocumento = new Map();
  const byCuenta = new Map();
  clients.forEach((c) => {
    const docNorm = normalize(c.documento || c.nif);
    if (docNorm && !byDocumento.has(docNorm)) byDocumento.set(docNorm, c);
    const cuenta = clean(c.cuentaContable);
    if (cuenta && !byCuenta.has(cuenta)) byCuenta.set(cuenta, c);
  });

  const wb = XLSX.readFile(excelPath, { cellDates: false, raw: true });
  const sheetNames = wb.SheetNames;

  const facturasSheetName =
    sheetNames.find((s) => clean(s).toLowerCase() === 'facturas pendientes') ||
    sheetNames.find((s) => clean(s).toLowerCase().includes('situacion economica'));
  const saldosSheetName = sheetNames.find((s) => clean(s).toLowerCase() === 'saldos');

  if (!facturasSheetName && !saldosSheetName) {
    throw new Error('No hay hojas facturas/saldos reconocibles en el Excel.');
  }

  const now = nowIso();
  const invoices = [];
  const balances = [];

  if (facturasSheetName) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[facturasSheetName], { defval: '', raw: true });
    rows.forEach((row, idx) => {
      const numero = clean(row['Factura'] || row['numero'] || row['Número']);
      if (!numero) return;
      const documento = clean(row['Identificador'] || row['Identificador_Cliente']);
      const cuentaContable = clean(row['Cuenta_Contable'] || row['Cuenta contable'] || row['Cuenta']);
      const nombreCliente = clean(row['Nombre_Cliente'] || row['Nombre_Cliente_Clientes']);
      const clientMatch = byDocumento.get(normalize(documento)) || byCuenta.get(cuentaContable);
      const clientId = clientMatch?.id || null;
      const issueDate = parseDate(row['Fecha_Factura'] || row['fecha']) || now;
      const amount = parseNumber(row['Importe_Neto'] || row['total'] || row['importe']);
      const rawStatus = clean(row['Situación'] || row['Estado']);
      const normalizedStatus = parseStatus(rawStatus);
      const id = `aga_inv_${normalize(cuentaContable || documento || 'sin')}_${normalize(numero)}_${idx + 1}`;

      invoices.push({
        id,
        source: 'AGA_EXCEL',
        sourceSheet: facturasSheetName,
        sourceStatus: rawStatus,
        normalizedStatus,
        clientId,
        clientName: nombreCliente || clientMatch?.nombre || 'SIN NOMBRE',
        clientIdentity: documento || clientMatch?.documento || '',
        cuentaContable: cuentaContable || clientMatch?.cuentaContable || '',
        number: numero,
        ejercicio: clean(row['Ejercicio']),
        issueDate,
        total: amount,
        updatedAt: now,
        createdAt: now,
      });
    });
  }

  if (saldosSheetName) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[saldosSheetName], { defval: '', raw: true });
    rows.forEach((row, idx) => {
      const cuentaContable = clean(row['Cuenta'] || row['Cuenta contable'] || row['Cuenta_Contable']);
      if (!cuentaContable) return;
      const saldoActual = parseNumber(row['Saldo actual'] || row['saldo']);
      const titulo = clean(row['Título'] || row['Titulo'] || row['Nombre']);
      const clientMatch = byCuenta.get(cuentaContable);
      const clientId = clientMatch?.id || null;
      const id = `aga_saldo_${normalize(cuentaContable)}_${idx + 1}`;
      balances.push({
        id,
        source: 'AGA_EXCEL',
        sourceSheet: saldosSheetName,
        clientId,
        clientName: clientMatch?.nombre || titulo || 'SIN NOMBRE',
        cuentaContable,
        titulo,
        saldoActual,
        updatedAt: now,
        createdAt: now,
      });
    });
  }

  const report = {
    executedAt: now,
    dryRun: !execute,
    excelPath,
    sheets: {
      facturas: facturasSheetName || null,
      saldos: saldosSheetName || null,
    },
    sourceCounts: {
      invoices: invoices.length,
      balances: balances.length,
    },
    targetBeforeCounts: {
      economicInvoices: existingEcoInvSnap.size,
      economicBalances: existingEcoBalanceSnap.size,
    },
    matching: {
      invoicesWithClientId: invoices.filter((x) => !!x.clientId).length,
      balancesWithClientId: balances.filter((x) => !!x.clientId).length,
    },
    sample: {
      invoice: invoices[0] || null,
      balance: balances[0] || null,
    },
  };

  const reportPath = path.resolve('/tmp', `import_aga_economic_excel_report_${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nImportador Económico AGA Excel -> Expedientes Pro');
  console.log('Excel:', excelPath);
  console.log('Facturas:', invoices.length, '| Saldos:', balances.length);
  console.log('Facturas con clientId:', report.matching.invoicesWithClientId);
  console.log('Saldos con clientId:', report.matching.balancesWithClientId);
  console.log('Report:', reportPath);

  if (!execute) {
    console.log('\nDRY-RUN: no se escribieron datos.');
    console.log(`Para ejecutar: node scripts/import-aga-economic-excel-to-expedientes-pro.cjs --execute --confirm ${CONFIRM_TOKEN}`);
    return;
  }

  if (confirm !== CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Debes usar --confirm ${CONFIRM_TOKEN}`);
  }

  const ops = [];
  invoices.forEach((inv) =>
    ops.push({
      ref: doc(db, 'economicInvoices', inv.id),
      data: sanitizeUndefinedDeep(inv),
    })
  );
  balances.forEach((bal) =>
    ops.push({
      ref: doc(db, 'economicBalances', bal.id),
      data: sanitizeUndefinedDeep(bal),
    })
  );

  await commitInChunks(ops, db);

  const [afterInv, afterBal] = await Promise.all([
    getDocs(collection(db, 'economicInvoices')),
    getDocs(collection(db, 'economicBalances')),
  ]);

  console.log('\nImportación económica completada.');
  console.log('economicInvoices:', afterInv.size, '| economicBalances:', afterBal.size);
}

run().catch((error) => {
  console.error('\nError importando económico AGA Excel:', error.message || error);
  process.exit(1);
});
