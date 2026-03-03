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
  '/Users/antoniosanchez/Library/Mobile Documents/com~apple~CloudDocs/AATRASPASOS/DATOS CLIENTES DEPURADOS.xlsx';
const CONFIRM_TOKEN = 'IMPORT_CLIENTES_DEPURADOS';
const BATCH_SIZE = 200;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return clean(value)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeDocumento(value) {
  const v = normalizeText(value);
  if (!v) return '';
  const stripped = v.replace(/[\s\-.,_/]/g, '');
  if (!stripped || stripped === ',') return '';
  return stripped;
}

function slug(value) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function detectTipo(documento) {
  return /^[A-Z]/.test(documento || '') ? 'EMPRESA' : 'PARTICULAR';
}

function resolveColumnIndex(headers, aliases, fallbackIndex = -1) {
  const normalizedAliases = aliases.map((a) => normalizeText(a));
  for (let i = 0; i < headers.length; i += 1) {
    const h = normalizeText(headers[i]);
    if (normalizedAliases.includes(h)) return i;
  }
  return fallbackIndex;
}

function pickCell(row, index) {
  if (index < 0) return '';
  return clean(row[index]);
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
        const backoff = Math.min(15000, 500 * 2 ** retry);
        console.warn(`⚠️ Reintento chunk ${chunkIndex} (${retry}/${MAX_RETRIES}) en ${backoff}ms`);
        await wait(backoff);
      }
    }
  }

  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const chunk = operations.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    const chunkIndex = Math.floor(i / BATCH_SIZE) + 1;
    chunk.forEach((op) => batch.set(op.ref, op.data, { merge: true }));
    await commitWithRetry(batch, chunkIndex);
    if (chunkIndex % 20 === 0) {
      console.log(`   ✓ chunks confirmados: ${Math.min(i + BATCH_SIZE, operations.length)}/${operations.length}`);
    }
    await wait(80);
  }
}

function parseArgValue(args, name, defaultValue = '') {
  const idx = args.findIndex((x) => x === name);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || defaultValue;
}

function hasArg(args, name) {
  return args.includes(name);
}

async function run() {
  const args = process.argv.slice(2);
  const execute = hasArg(args, '--execute');
  const confirm = parseArgValue(args, '--confirm');
  const excelPath = parseArgValue(args, '--excel', DEFAULT_EXCEL_PATH);
  const sheetNameArg = parseArgValue(args, '--sheet', '');

  if (!fs.existsSync(excelPath)) {
    throw new Error(`No existe el archivo Excel: ${excelPath}`);
  }

  const wb = XLSX.readFile(excelPath, { raw: true, cellDates: false });
  const targetSheetName = sheetNameArg
    ? wb.SheetNames.find((s) => normalizeText(s) === normalizeText(sheetNameArg)) || wb.SheetNames[0]
    : wb.SheetNames[0];
  const ws = wb.Sheets[targetSheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  if (!rows.length) throw new Error(`La hoja "${targetSheetName}" está vacía.`);

  const headers = rows[0].map((h) => clean(h));
  const idxCuenta = resolveColumnIndex(headers, ['Cuenta contable', 'Cuenta_Contable', 'Cuenta'], 0);
  const idxDocumento = resolveColumnIndex(headers, ['Identificad', 'Identificador', 'NIF', 'CIF', 'DNI'], 2);
  const idxNombre = resolveColumnIndex(headers, ['Nombre completo', 'Nombre', 'Razon social', 'Razón social'], 4);
  const idxDomicilio = resolveColumnIndex(headers, ['Domicilio completo', 'Direccion', 'Dirección'], 13);
  const idxPoblacion = resolveColumnIndex(headers, ['Población', 'Poblacion', 'Poblac'], 15);
  const idxProvincia = resolveColumnIndex(headers, ['Provincia'], 19);
  const idxIban = resolveColumnIndex(headers, ['Cód. IBAN', 'Cod. IBAN', 'IBAN'], 6);
  const idxContacto = resolveColumnIndex(headers, ['CONTACTO', 'Datos Contacto Importados CCS', 'datosContactoImportadosCCS'], 25);

  const now = new Date().toISOString();
  const transformed = [];
  let skippedNoNombre = 0;
  let skippedNoDocumento = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const nombre = clean(pickCell(row, idxNombre));
    const documento = normalizeDocumento(pickCell(row, idxDocumento));
    const cuentaContable = clean(pickCell(row, idxCuenta));

    if (!nombre) {
      skippedNoNombre += 1;
      continue;
    }
    if (!documento) {
      skippedNoDocumento += 1;
      continue;
    }

    const stableId = `cli_${slug(documento || cuentaContable || `row_${i + 1}`)}`;
    transformed.push({
      id: stableId,
      nombre,
      documento,
      nif: documento,
      tipo: detectTipo(documento),
      estado: 'ACTIVO',
      direccion: clean(pickCell(row, idxDomicilio)) || undefined,
      poblacion: clean(pickCell(row, idxPoblacion)) || undefined,
      provincia: clean(pickCell(row, idxProvincia)) || undefined,
      cuentaContable: cuentaContable || undefined,
      iban: clean(pickCell(row, idxIban)) || undefined,
      datosContactoImportadosCCS: clean(pickCell(row, idxContacto)) || undefined,
      source: 'CLIENTES_DEPURADOS_XLSX',
      sourceSheet: targetSheetName,
      updatedAt: now,
      createdAt: now,
    });
  }

  const app =
    getApps().find((a) => a.name === 'target-expedientes-pro-clientes-depurados') ||
    initializeApp(TARGET_FIREBASE_CONFIG, 'target-expedientes-pro-clientes-depurados');
  const db = getFirestore(app);

  const existingSnapshot = await getDocs(collection(db, 'clients'));
  const existing = existingSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  const byDocumento = new Map();
  existing.forEach((c) => {
    const docNorm = normalizeDocumento(c.documento || c.nif || '');
    if (docNorm && !byDocumento.has(docNorm)) byDocumento.set(docNorm, c);
  });

  const plan = { create: [], update: [], unchanged: 0 };

  transformed.forEach((c) => {
    const match = byDocumento.get(c.documento);
    if (!match) {
      plan.create.push(c);
      return;
    }
    const same =
      clean(match.nombre) === clean(c.nombre) &&
      clean(match.documento || match.nif) === clean(c.documento) &&
      clean(match.cuentaContable) === clean(c.cuentaContable) &&
      clean(match.iban) === clean(c.iban) &&
      clean(match.direccion) === clean(c.direccion);
    if (same) {
      plan.unchanged += 1;
    } else {
      plan.update.push({ id: match.id, data: c });
    }
  });

  const report = {
    executedAt: now,
    dryRun: !execute,
    excelPath,
    sheet: targetSheetName,
    sourceRows: rows.length - 1,
    transformed: transformed.length,
    skippedNoNombre,
    skippedNoDocumento,
    targetBefore: existingSnapshot.size,
    plan: {
      create: plan.create.length,
      update: plan.update.length,
      unchanged: plan.unchanged,
    },
    sample: {
      create: plan.create[0] || null,
      update: plan.update[0] || null,
    },
  };

  const reportPath = path.resolve('/tmp', `import_clientes_depurados_report_${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nImportador CLIENTES DEPURADOS -> clients');
  console.log('Excel:', excelPath);
  console.log('Hoja:', targetSheetName);
  console.log('Filas origen:', rows.length - 1, '| Transformados:', transformed.length);
  console.log('Plan create:', plan.create.length, 'update:', plan.update.length, 'unchanged:', plan.unchanged);
  console.log('Saltados por nombre vacío:', skippedNoNombre, '| por identificador vacío:', skippedNoDocumento);
  console.log('Report:', reportPath);

  if (!execute) {
    console.log('\nDRY-RUN: no se escribieron datos.');
    console.log(`Para ejecutar: node scripts/import-clients-depurados.cjs --execute --confirm ${CONFIRM_TOKEN}`);
    return;
  }

  if (confirm !== CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Debes usar --confirm ${CONFIRM_TOKEN}`);
  }

  const ops = [];
  plan.create.forEach((c) => {
    ops.push({ ref: doc(db, 'clients', c.id), data: sanitizeUndefinedDeep(c) });
  });
  plan.update.forEach((u) => {
    ops.push({
      ref: doc(db, 'clients', u.id),
      data: sanitizeUndefinedDeep({ ...u.data, id: u.id, updatedAt: new Date().toISOString() }),
    });
  });

  await commitInChunks(db, ops);

  const afterSnapshot = await getDocs(collection(db, 'clients'));
  console.log('\nImportación completada.');
  console.log('Clients antes:', existingSnapshot.size, '| después:', afterSnapshot.size);
}

run().catch((error) => {
  console.error('\nError importando CLIENTES DEPURADOS:', error.message || error);
  process.exit(1);
});
