#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, writeBatch } = require('firebase/firestore');

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
const CONFIRM_TOKEN = 'IMPORT_AGA_EXCEL';
const BATCH_SIZE = 150;
const INTER_BATCH_DELAY_MS = 120;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toUpperCase().replace(/[\s.\-_/]/g, '');
}

function nowIso() {
  return new Date().toISOString();
}

function slug(value) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const txt = clean(value).replace(/\./g, '').replace(',', '.');
  const n = Number(txt);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeUndefinedDeep);
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      if (v !== undefined) {
        out[k] = sanitizeUndefinedDeep(v);
      }
    });
    return out;
  }
  return value;
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

  const parsed = new Date(txt);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
}

function parseArgValue(args, name, defaultValue = '') {
  const idx = args.findIndex((x) => x === name);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || defaultValue;
}

function hasArg(args, name) {
  return args.includes(name);
}

function inferStatusFromSheetName(sheetName, saldoDebe) {
  const lower = clean(sheetName).toLowerCase();
  if (lower.includes('cerrad')) return 'Cerrado';
  if (lower.includes('abiert')) return 'Iniciado';
  return parseNumber(saldoDebe) <= 0 ? 'Cerrado' : 'Iniciado';
}

function inferSituation(status) {
  return status === 'Cerrado' ? 'Cerrado' : 'Iniciado';
}

function extractPrefixCode(fileNumber) {
  const txt = clean(fileNumber).toUpperCase();
  if (!txt.includes('-')) return '';
  return txt.split('-')[0].trim();
}

function inferCategory(prefixCode) {
  const prefix = clean(prefixCode).toUpperCase();
  if (prefix.startsWith('FI')) return 'FI-TRI';
  if (prefix.startsWith('GE') || prefix.startsWith('TT') || prefix.startsWith('RE') || prefix.startsWith('LI')) return 'GE-MAT';
  return 'FI-CONTA';
}

function sameClient(a, b) {
  return (
    clean(a.nombre) === clean(b.nombre) &&
    clean(a.documento || a.nif) === clean(b.documento || b.nif) &&
    clean(a.cuentaContable) === clean(b.cuentaContable) &&
    clean(a.estado || 'ACTIVO') === clean(b.estado || 'ACTIVO')
  );
}

function sameCase(a, b) {
  return (
    clean(a.fileNumber) === clean(b.fileNumber) &&
    clean(a.clienteId) === clean(b.clienteId) &&
    clean(a.status) === clean(b.status) &&
    clean(a.prefixId) === clean(b.prefixId)
  );
}

function toJsonRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
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
        if (!retryable || retry >= MAX_RETRIES) {
          throw error;
        }
        retry += 1;
        const backoff = Math.min(15000, 400 * 2 ** retry);
        console.warn(`⚠️ Reintento chunk ${chunkIndex} (retry ${retry}/${MAX_RETRIES}) en ${backoff}ms`);
        await wait(backoff);
      }
    }
  }

  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = ops.slice(i, i + BATCH_SIZE);
    const chunkIndex = Math.floor(i / BATCH_SIZE) + 1;
    chunk.forEach((op) => batch.set(op.ref, op.data, { merge: true }));
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
    throw new Error(`No existe el archivo Excel: ${excelPath}`);
  }

  const wb = XLSX.readFile(excelPath, { cellDates: false, raw: true });
  const sheetNames = wb.SheetNames;
  const clientsSheetName = sheetNames.find((s) => clean(s).toLowerCase() === 'clientes');
  const expedienteSheetNames = sheetNames.filter((s) => clean(s).toLowerCase().includes('expedientes'));

  if (!clientsSheetName) {
    throw new Error('No se encontró la hoja "clientes" en el Excel.');
  }
  if (expedienteSheetNames.length === 0) {
    throw new Error('No se encontraron hojas de expedientes en el Excel (nombre con "expedientes").');
  }

  const targetApp =
    getApps().find((a) => a.name === 'target-expedientes-pro-excel') ||
    initializeApp(TARGET_FIREBASE_CONFIG, 'target-expedientes-pro-excel');
  const targetDb = getFirestore(targetApp);

  const [targetClientsSnap, targetCasesSnap, prefixesSnap] = await Promise.all([
    getDocs(collection(targetDb, 'clients')),
    getDocs(collection(targetDb, 'cases')),
    getDocs(collection(targetDb, 'prefixes')),
  ]);

  const validPrefixIds = new Set(prefixesSnap.docs.map((d) => d.id));

  const targetClients = targetClientsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const targetCases = targetCasesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const byDocumento = new Map();
  const byCuenta = new Map();
  targetClients.forEach((c) => {
    const docNorm = normalize(c.documento || c.nif);
    if (docNorm && !byDocumento.has(docNorm)) byDocumento.set(docNorm, c);
    const cuenta = clean(c.cuentaContable);
    if (cuenta && !byCuenta.has(cuenta)) byCuenta.set(cuenta, c);
  });

  const byFileNumber = new Map();
  targetCases.forEach((c) => {
    const fn = clean(c.fileNumber);
    if (fn && !byFileNumber.has(fn)) byFileNumber.set(fn, c);
  });

  const rawClients = toJsonRows(wb.Sheets[clientsSheetName]);
  const transformedClients = [];

  rawClients.forEach((row, idx) => {
    const cuentaContable = clean(row['Cuenta contable'] || row['Cuenta_Contable'] || row['Cuenta']);
    const documento = clean(row['Identificad'] || row['Identificador'] || row['CIF'] || row['NIF']);
    const nombre = clean(row['Nombre completo'] || row['Nombre_Cliente'] || row['Nombre']);

    if (!cuentaContable && !documento) return;
    if (!nombre) return;

    const stableId = `aga_${slug(documento || cuentaContable || `row_${idx + 2}`)}`;
    transformedClients.push({
      id: stableId,
      nombre,
      documento: documento || undefined,
      nif: documento || undefined,
      cuentaContable: cuentaContable || undefined,
      estado: 'ACTIVO',
      tipo: documento && /^[A-Z]/.test(documento) ? 'EMPRESA' : 'PARTICULAR',
      direccion: clean(row['Domicilio completo']) || undefined,
      poblacion: clean(row['Población'] || row['Poblac']) || undefined,
      provincia: clean(row['Provincia']) || undefined,
      iban: clean(row['Cód. IBAN'] || row['IBAN']) || undefined,
      source: 'AGA_EXCEL',
      sourceSheet: clientsSheetName,
      updatedAt: nowIso(),
      createdAt: nowIso(),
    });
  });

  const clientByDocumento = new Map();
  const clientByCuenta = new Map();
  transformedClients.forEach((c) => {
    const docNorm = normalize(c.documento || '');
    if (docNorm && !clientByDocumento.has(docNorm)) clientByDocumento.set(docNorm, c);
    const cuenta = clean(c.cuentaContable);
    if (cuenta && !clientByCuenta.has(cuenta)) clientByCuenta.set(cuenta, c);
  });

  const transformedCases = [];
  expedienteSheetNames.forEach((sheetName) => {
    const rows = toJsonRows(wb.Sheets[sheetName]);
    rows.forEach((row, idx) => {
      const fileNumber = clean(
        row['Expediente'] || row['expediente'] || row['Número expediente'] || row['Numero expediente']
      ).toUpperCase();
      if (!fileNumber) return;

      const documento = clean(row['Identificador'] || row['Identificad']);
      const cuentaContable = clean(row['Cuenta_Contable'] || row['Cuenta contable'] || row['Cuenta']);
      const nombreCliente = clean(row['Nombre_Cliente'] || row['Nombre completo'] || row['Nombre']);
      const saldoDebe = parseNumber(row['Saldo_debe'] || row['Saldo Debe'] || row['Saldo']);
      const fechaApertura =
        parseDate(row['Fecha_de_apertura'] || row['Fecha apertura'] || row['Fecha_Apertura_Expediente']) || nowIso();

      const fromExcelClient =
        clientByDocumento.get(normalize(documento)) || clientByCuenta.get(cuentaContable);
      const fromTargetClient =
        byDocumento.get(normalize(documento)) || byCuenta.get(cuentaContable);

      const linkedClientId =
        fromTargetClient?.id ||
        fromExcelClient?.id ||
        `aga_${slug(documento || cuentaContable || `exp_${sheetName}_${idx + 2}`)}`;
      const clientName = nombreCliente || fromExcelClient?.nombre || fromTargetClient?.nombre || 'SIN NOMBRE';

      const prefixCode = extractPrefixCode(fileNumber);
      const prefixIdCandidate = prefixCode ? `prefix_${prefixCode}` : '';
      const prefixId = validPrefixIds.has(prefixIdCandidate) ? prefixIdCandidate : undefined;

      const status = inferStatusFromSheetName(sheetName, saldoDebe);

      transformedCases.push({
        fileNumber,
        clienteId: linkedClientId,
        clientSnapshot: {
          id: linkedClientId,
          nombre: clientName,
          documento: documento || fromExcelClient?.documento || fromTargetClient?.documento || '',
        },
        client: {
          id: linkedClientId,
          surnames: '',
          firstName: clientName,
          nif: documento || fromExcelClient?.documento || fromTargetClient?.documento || '',
          address: '',
          city: '',
          province: '',
          postalCode: '',
          phone: '',
          email: '',
        },
        vehicle: {
          vin: '',
          brand: '',
          model: '',
          year: '',
          engineSize: '',
          fuelType: '',
        },
        fileConfig: {
          fileType: '',
          category: inferCategory(prefixCode),
          responsibleUserId: '',
          customValues: {},
        },
        prefixId,
        economicData: {
          lines: [],
          subtotalAmount: 0,
          vatAmount: 0,
          totalAmount: 0,
        },
        communications: [],
        status,
        attachments: [],
        tasks: [],
        createdAt: fechaApertura,
        updatedAt: nowIso(),
        closedAt: status === 'Cerrado' ? nowIso() : undefined,
        situation: inferSituation(status),
        source: 'AGA_EXCEL',
        sourceSheet: sheetName,
        sourceSaldoDebe: saldoDebe,
      });
    });
  });

  const clientPlan = { create: [], update: [], unchanged: 0 };
  transformedClients.forEach((c) => {
    const match = byDocumento.get(normalize(c.documento || '')) || byCuenta.get(clean(c.cuentaContable));
    if (!match) {
      clientPlan.create.push(c);
      return;
    }
    if (sameClient(match, c)) {
      clientPlan.unchanged += 1;
    } else {
      clientPlan.update.push({ id: match.id, data: c });
    }
  });

  const casePlan = { create: [], update: [], unchanged: 0 };
  transformedCases.forEach((c) => {
    const match = byFileNumber.get(c.fileNumber);
    if (!match) {
      casePlan.create.push(c);
      return;
    }
    if (sameCase(match, c)) {
      casePlan.unchanged += 1;
    } else {
      casePlan.update.push({ id: match.fileNumber, data: c });
    }
  });

  const report = {
    executedAt: nowIso(),
    dryRun: !execute,
    excelPath,
    sheets: {
      clientsSheet: clientsSheetName,
      expedienteSheets: expedienteSheetNames,
    },
    sourceCounts: {
      rawClientsRows: rawClients.length,
      transformedClients: transformedClients.length,
      transformedCases: transformedCases.length,
    },
    targetBeforeCounts: {
      clients: targetClientsSnap.size,
      cases: targetCasesSnap.size,
    },
    plan: {
      clients: {
        create: clientPlan.create.length,
        update: clientPlan.update.length,
        unchanged: clientPlan.unchanged,
      },
      cases: {
        create: casePlan.create.length,
        update: casePlan.update.length,
        unchanged: casePlan.unchanged,
      },
    },
    sample: {
      createClient: clientPlan.create[0] || null,
      createCase: casePlan.create[0] || null,
      updateClient: clientPlan.update[0] || null,
      updateCase: casePlan.update[0] || null,
    },
  };

  const reportPath = path.resolve('/tmp', `import_aga_excel_report_${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nImportador AGA Excel -> Expedientes Pro');
  console.log('Excel:', excelPath);
  console.log('Hojas expedientes:', expedienteSheetNames.join(', '));
  console.log('Source transformed -> clients:', transformedClients.length, 'cases:', transformedCases.length);
  console.log('Plan clients -> create:', clientPlan.create.length, 'update:', clientPlan.update.length, 'unchanged:', clientPlan.unchanged);
  console.log('Plan cases   -> create:', casePlan.create.length, 'update:', casePlan.update.length, 'unchanged:', casePlan.unchanged);
  console.log('Report:', reportPath);

  if (!execute) {
    console.log('\nDRY-RUN: no se escribieron datos.');
    console.log(`Para ejecutar: node scripts/import-aga-excel-to-expedientes-pro.cjs --execute --confirm ${CONFIRM_TOKEN}`);
    return;
  }

  if (confirm !== CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Debes usar --confirm ${CONFIRM_TOKEN}`);
  }

  const ops = [];
  clientPlan.create.forEach((c) =>
    ops.push({ ref: doc(targetDb, 'clients', c.id), data: sanitizeUndefinedDeep(c) })
  );
  clientPlan.update.forEach((c) =>
    ops.push({
      ref: doc(targetDb, 'clients', c.id),
      data: sanitizeUndefinedDeep({ ...c.data, updatedAt: nowIso() }),
    })
  );
  casePlan.create.forEach((c) =>
    ops.push({ ref: doc(targetDb, 'cases', c.fileNumber), data: sanitizeUndefinedDeep(c) })
  );
  casePlan.update.forEach((c) =>
    ops.push({
      ref: doc(targetDb, 'cases', c.id),
      data: sanitizeUndefinedDeep({ ...c.data, updatedAt: nowIso() }),
    })
  );

  await commitInChunks(ops, targetDb);

  const [afterClients, afterCases] = await Promise.all([
    getDocs(collection(targetDb, 'clients')),
    getDocs(collection(targetDb, 'cases')),
  ]);

  console.log('\nImportación completada.');
  console.log('Target clients:', afterClients.size, '| Target cases:', afterCases.size);
}

run().catch((error) => {
  console.error('\nError importando AGA Excel:', error.message || error);
  process.exit(1);
});
