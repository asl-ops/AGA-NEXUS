#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: 'AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo',
  authDomain: 'gestor-de-expedientes-pro.firebaseapp.com',
  projectId: 'gestor-de-expedientes-pro',
  storageBucket: 'gestor-de-expedientes-pro.firebasestorage.app',
  messagingSenderId: '266201334385',
  appId: '1:266201334385:web:41e33a97d264660de951d0',
};

const MASTER_CONFIG_COLLECTIONS = [
  'prefixes',
  'prefijoMovimientos',
  'users',
  'payment_methods',
  'settings',
  'economicTemplates',
  'movimientoCuentasContables',
  'movimientos',
];

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
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

async function run() {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  const db = getFirestore(app);

  const backupDir = path.resolve(process.cwd(), 'backups', 'config-master');
  fs.mkdirSync(backupDir, { recursive: true });

  const payload = {
    createdAt: new Date().toISOString(),
    projectId: firebaseConfig.projectId,
    scope: 'master-config',
    protectedCollections: MASTER_CONFIG_COLLECTIONS,
    data: {},
  };

  payload.data.prefixes = await exportPrefixesWithMovements(db);

  for (const collectionName of MASTER_CONFIG_COLLECTIONS) {
    if (collectionName === 'prefixes') continue;
    payload.data[collectionName] = await exportCollection(db, collectionName);
  }

  const outputFile = path.join(backupDir, `master-config-backup-${nowStamp()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2), 'utf8');

  console.log('Backup de configuración generado.');
  console.log('Archivo:', outputFile);
  console.log('Prefijos:', payload.data.prefixes.count);
  console.log('Prefijo movimientos (subcolección total):', payload.data.prefixes.docs.reduce((acc, p) => acc + (p.movementsCount || 0), 0));
}

run().catch((error) => {
  console.error('Error generando backup de configuración:', error);
  process.exit(1);
});
