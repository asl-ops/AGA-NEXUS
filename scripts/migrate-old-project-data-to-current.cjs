#!/usr/bin/env node
/* eslint-disable no-console */
const { initializeApp, getApps } = require('firebase/app');
const {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  query,
  orderBy,
  limit,
  startAfter,
  documentId,
} = require('firebase/firestore');

const SOURCE_CONFIG = {
  apiKey: 'AIzaSyCPtIvlPqSFj3FAsoShh5xgc2R_izUpCp8',
  authDomain: 'gestor-expedientes-pro.firebaseapp.com',
  projectId: 'gestor-expedientes-pro',
  storageBucket: 'gestor-de-expedientes-pro.firebasestorage.app',
  messagingSenderId: '106962932821',
  appId: '1:106962932821:web:f3a3deaef34cde4add30dc',
};

const TARGET_CONFIG = {
  apiKey: 'AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo',
  authDomain: 'gestor-de-expedientes-pro.firebaseapp.com',
  projectId: 'gestor-de-expedientes-pro',
  storageBucket: 'gestor-de-expedientes-pro.firebasestorage.app',
  messagingSenderId: '266201334385',
  appId: '1:266201334385:web:41e33a97d264660de951d0',
};

const COLLECTIONS = [
  'clients',
  'cases',
  'vehicles',
  'users',
  'settings',
  'economicTemplates',
  'prefixes',
  'prefijoMovimientos',
  'movimientos',
  'movimientoCuentasContables',
  'payment_methods',
  'invoices',
  'proformas',
  'deliveryNotes',
  'economicInvoices',
  'economicBalances',
  'economicLedgerEntries',
  'clientEconomicSummary',
  'clientArchiveIndex',
];

const PAGE_SIZE = 500;
const BATCH_SIZE = 120;
const CONFIRM_TOKEN = 'MIGRATE_OLD_TO_CURRENT';

function hasArg(args, name) {
  return args.includes(name);
}

function parseArgValue(args, name, defaultValue = '') {
  const idx = args.findIndex((x) => x === name);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || defaultValue;
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

async function readCollectionPaged(db, collectionName) {
  const all = [];
  let cursor = null;

  while (true) {
    let q = query(
      collection(db, collectionName),
      orderBy(documentId()),
      limit(PAGE_SIZE)
    );
    if (cursor) {
      q = query(
        collection(db, collectionName),
        orderBy(documentId()),
        startAfter(cursor),
        limit(PAGE_SIZE)
      );
    }

    const snap = await getDocs(q);
    if (snap.empty) break;

    snap.docs.forEach((d) => {
      all.push({ id: d.id, data: d.data() });
    });

    cursor = snap.docs[snap.docs.length - 1].id;
    if (snap.docs.length < PAGE_SIZE) break;
  }

  return all;
}

async function writeCollectionBatched(db, collectionName, docs) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    let attempt = 0;
    while (true) {
      const batch = writeBatch(db);
      chunk.forEach((item) => {
        batch.set(
          doc(db, collectionName, item.id),
          sanitizeUndefinedDeep(item.data),
          { merge: true }
        );
      });
      try {
        await batch.commit();
        break;
      } catch (error) {
        const code = String(error?.code || '');
        const msg = String(error?.message || '');
        const retryable =
          code.includes('resource-exhausted') ||
          code.includes('unavailable') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('UNAVAILABLE');
        if (!retryable || attempt >= 10) {
          throw error;
        }
        attempt += 1;
        const waitMs = Math.min(15000, 500 * 2 ** attempt);
        console.warn(
          `⚠️ ${collectionName} chunk ${Math.floor(i / BATCH_SIZE) + 1}: reintento ${attempt} en ${waitMs}ms (${code || msg})`
        );
        await sleep(waitMs);
      }
    }
    if ((i / BATCH_SIZE) % 25 === 0) {
      await sleep(150);
    }
  }
}

async function run() {
  const args = process.argv.slice(2);
  const execute = hasArg(args, '--execute');
  const confirm = parseArgValue(args, '--confirm', '');
  const only = parseArgValue(args, '--only', '');

  if (execute && confirm !== CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Usa --confirm ${CONFIRM_TOKEN}`);
  }

  const selectedCollections = only
    ? only.split(',').map((x) => x.trim()).filter(Boolean)
    : COLLECTIONS;

  const srcApp =
    getApps().find((a) => a.name === 'migrate-old-src') ||
    initializeApp(SOURCE_CONFIG, 'migrate-old-src');
  const dstApp =
    getApps().find((a) => a.name === 'migrate-old-dst') ||
    initializeApp(TARGET_CONFIG, 'migrate-old-dst');

  const srcDb = getFirestore(srcApp);
  const dstDb = getFirestore(dstApp);

  console.log('Origen :', SOURCE_CONFIG.projectId);
  console.log('Destino:', TARGET_CONFIG.projectId);
  console.log('Modo   :', execute ? 'EJECUCION' : 'DRY-RUN');
  console.log('Colecciones:', selectedCollections.join(', '));

  const report = {
    startedAt: new Date().toISOString(),
    mode: execute ? 'execute' : 'dry-run',
    sourceProjectId: SOURCE_CONFIG.projectId,
    targetProjectId: TARGET_CONFIG.projectId,
    collections: [],
    totals: {
      read: 0,
      written: 0,
    },
  };

  for (const col of selectedCollections) {
    const started = Date.now();
    try {
      const docs = await readCollectionPaged(srcDb, col);
      const readCount = docs.length;
      let writtenCount = 0;
      if (execute && readCount > 0) {
        await writeCollectionBatched(dstDb, col, docs);
        writtenCount = readCount;
      }
      const elapsedMs = Date.now() - started;

      report.collections.push({
        collection: col,
        read: readCount,
        written: writtenCount,
        elapsedMs,
        status: 'ok',
      });
      report.totals.read += readCount;
      report.totals.written += writtenCount;
      console.log(
        `✓ ${col}: leidos=${readCount} escritos=${writtenCount} tiempo=${elapsedMs}ms`
      );
    } catch (error) {
      const elapsedMs = Date.now() - started;
      report.collections.push({
        collection: col,
        read: 0,
        written: 0,
        elapsedMs,
        status: 'error',
        error: String(error?.message || error),
      });
      console.error(`✗ ${col}:`, error?.message || error);
    }
  }

  report.finishedAt = new Date().toISOString();
  report.elapsedMs = Date.now() - new Date(report.startedAt).getTime();

  console.log('\nResumen:');
  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error('\n❌ Error en migración:', error?.message || error);
  process.exit(1);
});
