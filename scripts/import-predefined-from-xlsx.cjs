#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { initializeApp, getApps } = require('firebase/app');
const {
  getFirestore,
  collection,
  doc,
  getDocs,
  writeBatch,
  query,
  where,
} = require('firebase/firestore');

const firebaseConfig = {
  apiKey: 'AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo',
  authDomain: 'gestor-de-expedientes-pro.firebaseapp.com',
  projectId: 'gestor-de-expedientes-pro',
  storageBucket: 'gestor-de-expedientes-pro.firebasestorage.app',
  messagingSenderId: '266201334385',
  appId: '1:266201334385:web:41e33a97d264660de951d0',
};

const TARGET_PREFIX_CODES = [
  'ABOGA',
  'DIGI',
  'ESNOT',
  'FICEN',
  'FICER',
  'FICONTA',
  'FIIAE',
  'FIRE',
  'FITRI',
  'GEMAT',
  'GETRA',
  'LACON',
  'LADEV',
  'LANYSS',
  'LAPRES',
  'LASS',
  'LATRI',
  'LICON',
  'REMAT',
  'REPER',
  'TITULO',
  'TTCAP',
  'TTPET',
  'TTSUS',
  'TTVISA',
  'VARIOS',
];

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAmount(value) {
  const s = clean(value);
  if (!s) return 0;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function normalizeCode(value) {
  return clean(value).toUpperCase().replace(/[\s-]+/g, '');
}

function parseXlsx(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const sections = [];
  let current = null;

  for (const rawRow of rows) {
    const row = rawRow.map(clean);

    if (row[1] === 'Prefijo' && row[4] && row[4] !== '??') {
      current = {
        prefijo: row[4],
        lines: [],
      };
      sections.push(current);
      continue;
    }

    if (!current) continue;

    // Gestión row
    if (/^\d+$/.test(row[2] || '') && row[3] && row[8]) {
      current.lines.push({
        gestion: Number(row[2]),
        descripcionGestion: row[3],
        codigo: row[8],
        nombreMovimiento: row[9] || row[3],
        importe: parseAmount(row[14]),
        activo: (row[17] || '').toUpperCase() === 'SI', // Column R in Excel
      });
    }
  }

  const merged = new Map();
  for (const section of sections) {
    if (!merged.has(section.prefijo)) {
      merged.set(section.prefijo, { prefijo: section.prefijo, lines: [...section.lines] });
      continue;
    }
    const existing = merged.get(section.prefijo);
    existing.lines.push(...section.lines);
  }

  for (const [, value] of merged) {
    value.lines.sort((a, b) => a.gestion - b.gestion);
  }

  return merged;
}

async function commitInChunks(db, operations) {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of chunk) {
      if (op.type === 'set') batch.set(op.ref, op.data);
      if (op.type === 'delete') batch.delete(op.ref);
    }
    await batch.commit();
  }
}

async function run() {
  const excelPath = process.argv[2] || path.resolve('/Users/antoniosanchez/Downloads/PREFIJOS EXPEDIENTES Y SUS MOVIMIENTOS.xlsx');
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  const db = getFirestore(app);

  const parsed = parseXlsx(excelPath);
  const targetSet = new Set(TARGET_PREFIX_CODES);

  const prefixesSnap = await getDocs(collection(db, 'prefixes'));
  const existingPrefixCodes = new Set(prefixesSnap.docs.map((d) => d.id.replace(/^prefix_/, '')));

  const report = {
    excelPath,
    rule: 'solo Activo=Si se carga como predefinido',
    targetPrefixes: TARGET_PREFIX_CODES.length,
    importedPrefixes: [],
    skippedPrefixes: [],
    missingInExcel: [],
    missingInApp: [],
  };

  const operations = [];

  for (const code of TARGET_PREFIX_CODES) {
    if (!targetSet.has(code)) continue;
    const prefixId = `prefix_${code}`;

    if (!existingPrefixCodes.has(code)) {
      report.missingInApp.push(code);
      report.skippedPrefixes.push({ code, reason: 'No existe en prefixes' });
      continue;
    }

    const section = parsed.get(code);
    if (!section) {
      report.missingInExcel.push(code);
      report.skippedPrefixes.push({ code, reason: 'No aparece en Excel' });
      continue;
    }

    // Remove previous predefined movements for this prefix.
    const currentPrefSnap = await getDocs(
      query(collection(db, 'prefijoMovimientos'), where('prefijoId', '==', prefixId))
    );
    currentPrefSnap.docs.forEach((d) =>
      operations.push({ type: 'delete', ref: doc(db, 'prefijoMovimientos', d.id) })
    );

    // Build lookup from movement catalog for this prefix (by legacy row first).
    const catalogSnap = await getDocs(collection(db, 'prefixes', prefixId, 'movements'));
    const byLegacy = new Map();
    const byBaseCode = new Map();
    catalogSnap.docs.forEach((d) => {
      const data = d.data();
      const legacy = clean(data.legacyId || '');
      if (legacy && !byLegacy.has(legacy)) {
        byLegacy.set(legacy, { id: d.id, data });
      }
      const normCode = normalizeCode(data.codigo || '');
      if (normCode && !byBaseCode.has(normCode)) {
        byBaseCode.set(normCode, { id: d.id, data });
      }
    });

    const activeLines = section.lines.filter((line) => line.activo);
    let inserted = 0;
    let unresolved = 0;
    let order = 1;
    const now = new Date().toISOString();

    for (const line of activeLines) {
      const normCode = normalizeCode(line.codigo);
      const legacyKey = `${code}-${line.gestion}`;
      let catalogMovement = byLegacy.get(legacyKey);
      if (!catalogMovement) {
        // Fallback por código base para datos históricos ya existentes.
        catalogMovement = byBaseCode.get(normCode);
      }
      if (!catalogMovement) {
        unresolved += 1;
        continue;
      }

      const predefinedRef = doc(collection(db, 'prefijoMovimientos'));
      operations.push({
        type: 'set',
        ref: predefinedRef,
        data: {
          prefijoId: prefixId,
          movimientoId: catalogMovement.id,
          nombre: clean(line.descripcionGestion || line.nombreMovimiento || catalogMovement.data.nombre || normCode),
          orden: order,
          order: order,
          importePorDefecto: line.importe ?? 0,
          editableEnExpediente: true,
          estadoInicial: 'PENDIENTE',
          obligatorio: false,
          categoria: 'OPERATIVO',
          bloqueado: false,
          createdAt: now,
          updatedAt: now,
        },
      });
      inserted += 1;
      order += 1;
    }

    report.importedPrefixes.push({
      code,
      prefixId,
      sourceLines: section.lines.length,
      activeLines: activeLines.length,
      insertedPredefined: inserted,
      unresolvedActiveCodes: unresolved,
    });
  }

  await commitInChunks(db, operations);

  // Verify counts per prefix in prefijoMovimientos.
  const prefSnap = await getDocs(collection(db, 'prefijoMovimientos'));
  const verify = {};
  for (const code of TARGET_PREFIX_CODES) {
    const prefixId = `prefix_${code}`;
    verify[code] = prefSnap.docs.filter((d) => d.data().prefijoId === prefixId).length;
  }
  report.verifyPredefinedCounts = verify;

  const reportPath = '/tmp/import_predefined_from_excel_report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('Importación de predefinidos completada.');
  console.log('Reporte:', reportPath);
  console.log('Prefijos procesados:', report.importedPrefixes.length);
  console.log('Prefijos omitidos:', report.skippedPrefixes.length);
}

run().catch((error) => {
  console.error('Error al importar predefinidos:', error);
  process.exit(1);
});
