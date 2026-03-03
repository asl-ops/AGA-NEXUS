#!/usr/bin/env node
/* eslint-disable no-console */
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, query, limit } = require('firebase/firestore');
const { recalculateEconomicSummaries } = require('./lib/economic-summary-recalc.cjs');

const TARGET_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo',
  authDomain: 'gestor-de-expedientes-pro.firebaseapp.com',
  projectId: 'gestor-de-expedientes-pro',
  storageBucket: 'gestor-de-expedientes-pro.firebasestorage.app',
  messagingSenderId: '266201334385',
  appId: '1:266201334385:web:41e33a97d264660de951d0',
};

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
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
  const all = hasArg(args, '--all');
  const idsRaw = parseArgValue(args, '--ids', '');
  const sampleRaw = parseArgValue(args, '--sample', '');
  const skipYearly = hasArg(args, '--skip-yearly');
  const sampleSize = Number.parseInt(sampleRaw, 10);

  let clientIds = idsRaw
    ? idsRaw.split(',').map((x) => clean(x)).filter(Boolean)
    : null;

  if (!all && (!clientIds || clientIds.length === 0) && !(Number.isFinite(sampleSize) && sampleSize > 0)) {
    throw new Error('Debes indicar --all o --ids "id1,id2,id3"');
  }

  const app =
    getApps().find((a) => a.name === 'target-expedientes-pro-recalc-economic-summaries') ||
    initializeApp(TARGET_FIREBASE_CONFIG, 'target-expedientes-pro-recalc-economic-summaries');
  const db = getFirestore(app);

  if ((!clientIds || clientIds.length === 0) && Number.isFinite(sampleSize) && sampleSize > 0) {
    const sampleSnap = await getDocs(query(collection(db, 'clients'), limit(sampleSize)));
    clientIds = sampleSnap.docs.map((d) => d.id);
  }

  console.log('\nRecalculador de sumarios económicos');
  console.log('Modo:', all ? 'all clients' : `subset (${clientIds.length} ids)`);
  if (!all && Number.isFinite(sampleSize) && sampleSize > 0 && !idsRaw) {
    console.log('Muestra automática:', sampleSize);
  }
  console.log('Summary por ejercicio:', skipYearly ? 'NO' : 'SI');

  const recalc = await recalculateEconomicSummaries(db, {
    clientIds: all ? null : clientIds,
    includeYearly: !skipYearly,
    logPrefix: '[RECALC MANUAL]',
    writeTimingLog: true,
  });

  console.log('\nResultado:');
  console.log('Clientes procesados:', `${recalc.clientsCompleted}/${recalc.clientsRequested}`);
  console.log('Global summaries:', recalc.globalSummariesWritten);
  console.log('Yearly summaries:', recalc.yearlySummariesWritten);
  console.log('Tiempo total:', `${(recalc.totalMs / 1000).toFixed(2)}s`);
  console.log('Promedio por cliente:', `${(recalc.avgMsPerClient / 1000).toFixed(2)}s`);
  console.log('P95 por cliente:', `${(recalc.p95MsPerClient / 1000).toFixed(2)}s`);
  console.log('Clientes por minuto:', recalc.clientsPerMinute);
  console.log('Estimación 100 clientes:', `${recalc.estimatedFor100ClientsMinutes} min`);
  console.log('Estimación 1000 clientes:', `${recalc.estimatedFor1000ClientsMinutes} min`);
  console.log('Report:', recalc.reportPath || '(sin ruta)');
}

run().catch((error) => {
  console.error('\nError recalculando sumarios económicos:', error.message || error);
  process.exit(1);
});
