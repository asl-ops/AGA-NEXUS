#!/usr/bin/env node
/* eslint-disable no-console */
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

function buildUniqueCode(baseCode, suffix) {
  const normalized = normalizeCode(baseCode) || 'MOV';
  return `${normalized}_${suffix}`;
}

function extractDescription(row) {
  const idxDesc = row.findIndex((x) => x === 'Descripción');
  const idxProvision = row.findIndex((x) => x === 'Provisión de fondos');
  if (idxDesc === -1) return '';
  const start = idxDesc + 1;
  const end = idxProvision === -1 ? row.length : idxProvision;
  return row
    .slice(start, end)
    .filter(Boolean)
    .join(' ')
    .trim();
}

function parseWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const parsed = [];
  let current = null;

  for (const rawRow of rows) {
    const row = rawRow.map(clean);

    if (row[1] === 'Prefijo' && row[4] && row[4] !== '??') {
      current = {
        prefijo: row[4],
        descripcion: extractDescription(row),
        contador: null,
        movimientos: [],
      };
      parsed.push(current);
      continue;
    }

    if (!current) continue;

    if (row[1] === 'Importe honorarios') {
      current.contador = parseAmount(row[22]);
      continue;
    }

    if (/^\d+$/.test(row[2] || '') && row[3] && row[8]) {
      current.movimientos.push({
        gestion: Number(row[2]),
        descripcion: row[3],
        codigo: row[8],
        nombre: row[9] || row[3],
        importe: parseAmount(row[14]),
        activo: (row[17] || '').toUpperCase() === 'SI',
      });
    }
  }

  const merged = new Map();
  for (const section of parsed) {
    if (!merged.has(section.prefijo)) {
      merged.set(section.prefijo, {
        ...section,
        movimientos: [...section.movimientos],
      });
      continue;
    }

    const existing = merged.get(section.prefijo);
    if ((!existing.descripcion || existing.descripcion === '0') && section.descripcion && section.descripcion !== '0') {
      existing.descripcion = section.descripcion;
    }
    if ((!existing.contador || existing.contador === 0) && section.contador) {
      existing.contador = section.contador;
    }

    const seen = new Set(existing.movimientos.map((m) => `${m.gestion}|${normalizeCode(m.codigo)}|${m.descripcion}`));
    for (const movement of section.movimientos) {
      const key = `${movement.gestion}|${normalizeCode(movement.codigo)}|${movement.descripcion}`;
      if (!seen.has(key)) {
        existing.movimientos.push(movement);
        seen.add(key);
      }
    }
  }

  return merged;
}

async function commitInChunks(operations, db) {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    const chunk = operations.slice(i, i + CHUNK_SIZE);
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

  const parsed = parseWorkbook(excelPath);
  const targetSet = new Set(TARGET_PREFIX_CODES);

  const prefixesSnap = await getDocs(collection(db, 'prefixes'));
  const existingPrefixIds = prefixesSnap.docs.map((d) => d.id);
  const existingPrefixCodes = new Set(existingPrefixIds.map((id) => id.replace(/^prefix_/, '')));

  const missingInExcel = TARGET_PREFIX_CODES.filter((code) => !parsed.has(code));
  const missingInApp = TARGET_PREFIX_CODES.filter((code) => !existingPrefixCodes.has(code));

  const report = {
    excelPath,
    targetPrefixes: TARGET_PREFIX_CODES.length,
    missingInExcel,
    missingInApp,
    imported: [],
    skipped: [],
  };

  const operations = [];

  for (const code of TARGET_PREFIX_CODES) {
    const prefixId = `prefix_${code}`;
    if (!existingPrefixCodes.has(code)) {
      report.skipped.push({ code, reason: 'No existe en Firestore/prefixes' });
      continue;
    }

    const section = parsed.get(code);
    if (!section) {
      report.skipped.push({ code, reason: 'No aparece en Excel' });
      continue;
    }

    const existingMovSnap = await getDocs(collection(db, 'prefixes', prefixId, 'movements'));
    existingMovSnap.docs.forEach((d) => {
      operations.push({ type: 'delete', ref: doc(db, 'prefixes', prefixId, 'movements', d.id) });
    });

    const now = new Date().toISOString();
    let createdCount = 0;
    const seenCodes = new Set();
    for (const movement of section.movimientos) {
      const baseCode = normalizeCode(movement.codigo);
      if (!baseCode) continue;
      const uniqueCodeByGestion = buildUniqueCode(baseCode, String(movement.gestion));
      let finalCode = uniqueCodeByGestion;
      let collisionIndex = 2;
      while (seenCodes.has(finalCode)) {
        finalCode = buildUniqueCode(baseCode, `${movement.gestion}_${collisionIndex}`);
        collisionIndex += 1;
      }
      seenCodes.add(finalCode);

      const movementDocRef = doc(collection(db, 'prefixes', prefixId, 'movements'));
      operations.push({
        type: 'set',
        ref: movementDocRef,
        data: {
          codigo: finalCode,
          nombre: clean(movement.descripcion || movement.nombre || finalCode),
          naturaleza: 'HONORARIO',
          regimenIva: 'SUJETO',
          ivaPorDefecto: 21,
          afectaFactura: true,
          imprimibleEnFactura: true,
          afectaBaseImponible: true,
          afectaIva: true,
          modoImporte: 'FIJO',
          importePorDefecto: movement.importe ?? 0,
          // Regla funcional: en catálogo deben quedar visibles en "Todos"
          // y no depender del flag Activo(SI/NO) del Excel.
          activo: true,
          prefixId,
          legacyId: `${code}-${movement.gestion}`,
          createdAt: now,
          updatedAt: now,
        },
      });
      createdCount += 1;
    }

    report.imported.push({
      code,
      prefixId,
      sourceRows: section.movimientos.length,
      inserted: createdCount,
      deletedPrevious: existingMovSnap.size,
    });
  }

  await commitInChunks(operations, db);

  const verify = {};
  for (const code of TARGET_PREFIX_CODES) {
    const prefixId = `prefix_${code}`;
    if (!existingPrefixCodes.has(code)) continue;
    const snap = await getDocs(query(collection(db, 'prefixes', prefixId, 'movements'), where('activo', '==', true)));
    verify[code] = snap.size;
  }

  report.verifyActiveCounts = verify;
  const reportPath = '/tmp/import_prefix_movements_report.json';
  require('fs').writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('Importación completada.');
  console.log('Reporte:', reportPath);
  console.log('Prefijos importados:', report.imported.length);
  console.log('Prefijos omitidos:', report.skipped.length);
  if (report.missingInExcel.length) {
    console.log('Faltan en Excel:', report.missingInExcel.join(', '));
  }
}

run().catch((error) => {
  console.error('Error en importación:', error);
  process.exit(1);
});
