#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, writeBatch, deleteDoc } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: 'AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo',
  authDomain: 'gestor-de-expedientes-pro.firebaseapp.com',
  projectId: 'gestor-de-expedientes-pro',
  storageBucket: 'gestor-de-expedientes-pro.firebasestorage.app',
  messagingSenderId: '266201334385',
  appId: '1:266201334385:web:41e33a97d264660de951d0',
};

const PROTECTED_COLLECTIONS = [
  'prefixes',
  'prefijoMovimientos',
  'users',
  'payment_methods',
  'settings',
  'economicTemplates',
  'movimientoCuentasContables',
  'movimientos',
];

const OPERATIONAL_COLLECTIONS = [
  'clients',
  'cases',
  'vehicles',
  'deliveryNotes',
  'proformas',
  'invoices',
];

const CONFIRM_TOKEN = 'RESET_OPERATIVO';

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function hasArg(name) {
  return process.argv.includes(name);
}

function getArgValue(name) {
  const idx = process.argv.findIndex((a) => a === name);
  if (idx === -1) return '';
  return process.argv[idx + 1] || '';
}

async function commitDeleteOperations(db, refs) {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + CHUNK_SIZE)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function exportCollection(db, collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  return {
    count: snap.size,
    docs: snap.docs.map((d) => ({ id: d.id, data: d.data() })),
  };
}

async function exportPrefixesWithMovements(db) {
  const prefixesSnap = await getDocs(collection(db, 'prefixes'));
  const result = [];

  for (const prefixDoc of prefixesSnap.docs) {
    const movementsSnap = await getDocs(collection(db, 'prefixes', prefixDoc.id, 'movements'));
    result.push({
      id: prefixDoc.id,
      data: prefixDoc.data(),
      movements: movementsSnap.docs.map((m) => ({ id: m.id, data: m.data() })),
      movementsCount: movementsSnap.size,
    });
  }

  return {
    count: prefixesSnap.size,
    docs: result,
  };
}

async function backupMasterConfig(db) {
  const backupDir = path.resolve(process.cwd(), 'backups', 'config-master');
  fs.mkdirSync(backupDir, { recursive: true });

  const payload = {
    createdAt: new Date().toISOString(),
    projectId: firebaseConfig.projectId,
    scope: 'master-config',
    protectedCollections: PROTECTED_COLLECTIONS,
    data: {},
  };

  payload.data.prefixes = await exportPrefixesWithMovements(db);

  for (const collectionName of PROTECTED_COLLECTIONS) {
    if (collectionName === 'prefixes') continue;
    payload.data[collectionName] = await exportCollection(db, collectionName);
  }

  const outputFile = path.join(backupDir, `master-config-backup-${nowStamp()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2), 'utf8');
  return outputFile;
}

async function listOperationalCounts(db) {
  const counts = {};
  for (const c of OPERATIONAL_COLLECTIONS) {
    const snap = await getDocs(collection(db, c));
    counts[c] = snap.size;
  }
  return counts;
}

async function deleteOperationalCollections(db) {
  const deleted = {};
  for (const c of OPERATIONAL_COLLECTIONS) {
    const snap = await getDocs(collection(db, c));
    const refs = snap.docs.map((d) => doc(db, c, d.id));
    if (refs.length > 0) {
      await commitDeleteOperations(db, refs);
    }
    deleted[c] = refs.length;
  }
  return deleted;
}

async function clearOperationalCounters(db) {
  const counterIds = ['invoice_counter', 'proforma_counter', 'delivery_note_counter'];
  let removed = 0;
  for (const id of counterIds) {
    await deleteDoc(doc(db, 'counters', id));
    removed += 1;
  }
  return { removed, ids: counterIds };
}

async function run() {
  const dryRun = hasArg('--dry-run') || !hasArg('--execute');
  const confirm = getArgValue('--confirm');
  const resetCounters = hasArg('--reset-counters');

  const overlap = OPERATIONAL_COLLECTIONS.filter((c) => PROTECTED_COLLECTIONS.includes(c));
  if (overlap.length > 0) {
    throw new Error(`Configuración insegura: colecciones solapadas entre operativo y protegido: ${overlap.join(', ')}`);
  }

  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  const db = getFirestore(app);

  const countsBefore = await listOperationalCounts(db);
  const totalBefore = Object.values(countsBefore).reduce((acc, n) => acc + n, 0);

  console.log('\nReset seguro de datos operativos');
  console.log('Proyecto:', firebaseConfig.projectId);
  console.log('Colecciones operativas:', OPERATIONAL_COLLECTIONS.join(', '));
  console.log('Colecciones protegidas:', PROTECTED_COLLECTIONS.join(', '));
  console.log('Registros operativos detectados:', totalBefore);
  console.log('Detalle:', countsBefore);
  console.log('');

  if (dryRun) {
    console.log('DRY RUN activo: no se ha borrado nada.');
    console.log(`Para ejecutar: node scripts/reset-operational-data-safe.cjs --execute --confirm ${CONFIRM_TOKEN}`);
    console.log('Opcional: añade --reset-counters para reiniciar contadores operativos.');
    return;
  }

  if (confirm !== CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Debes usar --confirm ${CONFIRM_TOKEN}`);
  }

  const backupFile = await backupMasterConfig(db);
  console.log('Backup automático de configuración:', backupFile);

  const deleted = await deleteOperationalCollections(db);
  let countersResult = null;
  if (resetCounters) {
    countersResult = await clearOperationalCounters(db);
  }

  const countsAfter = await listOperationalCounts(db);
  const totalAfter = Object.values(countsAfter).reduce((acc, n) => acc + n, 0);

  const report = {
    executedAt: new Date().toISOString(),
    dryRun: false,
    resetCounters,
    backupFile,
    protectedCollections: PROTECTED_COLLECTIONS,
    operationalCollections: OPERATIONAL_COLLECTIONS,
    countsBefore,
    countsAfter,
    deleted,
    countersResult,
  };

  const reportPath = path.resolve('/tmp', `reset_operational_report_${nowStamp()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nReset completado.');
  console.log('Eliminados:', deleted);
  if (countersResult) {
    console.log('Contadores reiniciados:', countersResult.ids.join(', '));
  }
  console.log('Registros operativos restantes:', totalAfter);
  console.log('Reporte:', reportPath);
}

run().catch((error) => {
  console.error('\nError en reset seguro:', error.message || error);
  process.exit(1);
});
