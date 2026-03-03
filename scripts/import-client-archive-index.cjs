#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, doc, writeBatch } = require('firebase/firestore');

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
const CONFIRM_TOKEN = 'IMPORT_CLIENT_ARCHIVE_INDEX';
const BATCH_SIZE = 300;
const COLLECTION = 'clientArchiveIndex';

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
  return v ? v.replace(/\s|-/g, '') : '';
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

async function commitInChunks(db, operations) {
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = operations.slice(i, i + BATCH_SIZE);
    chunk.forEach((op) => batch.set(op.ref, op.data, { merge: true }));
    await batch.commit();
    if ((i / BATCH_SIZE + 1) % 10 === 0) {
      console.log(`   ✓ chunks confirmados: ${Math.min(i + BATCH_SIZE, operations.length)}/${operations.length}`);
    }
  }
}

async function run() {
  const args = process.argv.slice(2);
  const execute = hasArg(args, '--execute');
  const confirm = parseArgValue(args, '--confirm');
  const excelPath = parseArgValue(args, '--excel', DEFAULT_EXCEL_PATH);
  const sheetNameArg = parseArgValue(args, '--sheet', 'Clientes');

  if (!fs.existsSync(excelPath)) {
    throw new Error(`No existe el archivo Excel: ${excelPath}`);
  }

  const workbook = XLSX.readFile(excelPath, { raw: true, cellDates: false });
  const targetSheetName =
    workbook.SheetNames.find((s) => normalizeText(s) === normalizeText(sheetNameArg)) || workbook.SheetNames[0];
  const ws = workbook.Sheets[targetSheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

  if (!rows.length) throw new Error(`La hoja "${targetSheetName}" está vacía.`);

  const headers = rows[0].map((h) => clean(h));

  const idxCuenta = resolveColumnIndex(headers, ['Cuenta contable', 'Cuenta_Contable', 'Cuenta']);
  const idxDocumento = resolveColumnIndex(headers, ['Identificad', 'Identificador', 'NIF', 'CIF', 'DNI']);
  const idxNombre = resolveColumnIndex(headers, ['Nombre completo', 'Nombre', 'Razon social', 'Razón social']);
  const idxIban = resolveColumnIndex(headers, ['Cód. IBAN', 'Cod. IBAN', 'IBAN']);
  const idxDomicilio = resolveColumnIndex(headers, ['Domicilio completo', 'Direccion', 'Dirección']);
  const idxPoblacion = resolveColumnIndex(headers, ['Población', 'Poblac', 'Poblacion']);
  const idxProvincia = resolveColumnIndex(headers, ['Provincia']);
  const idxContactoImportado = resolveColumnIndex(
    headers,
    ['datosContactoImportadosCCS', 'Datos Contacto Importados CCS', 'Numero', 'Número', 'Descripcion', 'Descripción'],
    25
  ); // fallback columna Z

  const now = new Date().toISOString();
  const transformed = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const cuentaContable = pickCell(row, idxCuenta);
    const documento = pickCell(row, idxDocumento);
    const nombre = pickCell(row, idxNombre);

    if (!nombre && !documento && !cuentaContable) continue;
    if (!nombre) continue;

    const stableBase = documento || cuentaContable || `row_${i + 1}`;
    const id = `arc_${slug(stableBase)}`;
    const documentoNormalized = normalizeDocumento(documento);
    const nombreNormalized = normalizeText(nombre);

    transformed.push({
      id,
      nombre,
      nombreNormalized,
      documento: documento || undefined,
      nif: documento || undefined,
      documentoNormalized: documentoNormalized || undefined,
      cuentaContable: cuentaContable || undefined,
      direccion: pickCell(row, idxDomicilio) || undefined,
      poblacion: pickCell(row, idxPoblacion) || undefined,
      provincia: pickCell(row, idxProvincia) || undefined,
      iban: pickCell(row, idxIban) || undefined,
      datosContactoImportadosCCS: pickCell(row, idxContactoImportado) || undefined,
      source: 'CCS_EXCEL_ARCHIVE',
      sourceSheet: targetSheetName,
      rowNumber: i + 1,
      rescatado: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  const report = {
    executedAt: now,
    dryRun: !execute,
    excelPath,
    sheet: targetSheetName,
    totalRows: rows.length - 1,
    transformed: transformed.length,
    sample: transformed[0] || null,
  };

  const reportPath = path.resolve('/tmp', `import_client_archive_index_report_${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nImportador almacén clientes (clientArchiveIndex)');
  console.log('Excel:', excelPath);
  console.log('Hoja:', targetSheetName);
  console.log('Registros transformados:', transformed.length);
  console.log('Report:', reportPath);

  if (!execute) {
    console.log('\nDRY-RUN: no se escribió nada en Firestore.');
    console.log(`Para ejecutar: node scripts/import-client-archive-index.cjs --execute --confirm ${CONFIRM_TOKEN}`);
    return;
  }

  if (confirm !== CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Debes usar --confirm ${CONFIRM_TOKEN}`);
  }

  const app =
    getApps().find((a) => a.name === 'target-expedientes-pro-client-archive') ||
    initializeApp(TARGET_FIREBASE_CONFIG, 'target-expedientes-pro-client-archive');
  const db = getFirestore(app);

  const operations = transformed.map((row) => ({
    ref: doc(db, COLLECTION, row.id),
    data: sanitizeUndefinedDeep(row),
  }));

  await commitInChunks(db, operations);
  console.log(`\nImportación completada. Registros escritos en ${COLLECTION}: ${operations.length}`);
}

run().catch((error) => {
  console.error('\nError importando almacén de clientes:', error.message || error);
  process.exit(1);
});
