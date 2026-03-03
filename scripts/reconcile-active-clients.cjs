#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
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

const CONFIRM_TOKEN = 'RECONCILE_ACTIVE_CLIENTS';
const BATCH_SIZE = 250;

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
  return normalizeText(value).replace(/[\s\-.,_/]/g, '');
}

function slug(value) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value);
  const txt = clean(value);
  if (!txt) return 0;
  const normalized = txt.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
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

function hasArg(args, name) {
  return args.includes(name);
}

function parseArgValue(args, name, defaultValue = '') {
  const idx = args.findIndex((x) => x === name);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || defaultValue;
}

function detectCaseOpen(caseData) {
  if (caseData.closedAt) return false;
  const status = clean(caseData.status || caseData.estado || caseData.situacion).toLowerCase();
  if (status.includes('cerrad') || status.includes('closed') || status.includes('finaliz')) return false;
  return true;
}

function detectPendingInvoice(invData) {
  if (invData.softDeleted === true || invData.isActive === false) return false;
  if (invData.isPaid === true) return false;
  const normalizedStatus = clean(invData.normalizedStatus).toLowerCase();
  if (normalizedStatus === 'paid' || normalizedStatus === 'cancelled' || normalizedStatus === 'canceled') return false;
  const status = clean(invData.status).toLowerCase();
  if (status === 'paid' || status === 'cancelled' || status === 'canceled') return false;
  return true;
}

function detectBalanceWithAmount(balanceData) {
  if (balanceData.softDeleted === true || balanceData.isActive === false) return false;
  const saldo = parseNumber(balanceData.saldoActual ?? balanceData.saldo ?? balanceData.balance);
  return Math.abs(saldo) > 0;
}

function buildArchiveRecord(client, nowIso) {
  const documento = clean(client.documento || client.nif || '');
  const cuentaContable = clean(client.cuentaContable || '');
  const base = documento || cuentaContable || client.id;
  return {
    id: `arc_${slug(base)}`,
    nombre: clean(client.nombre || ''),
    nombreNormalized: normalizeText(client.nombre || ''),
    documento: documento || undefined,
    nif: documento || undefined,
    documentoNormalized: normalizeDocumento(documento || ''),
    cuentaContable: cuentaContable || undefined,
    direccion: clean(client.direccion || '') || undefined,
    poblacion: clean(client.poblacion || '') || undefined,
    provincia: clean(client.provincia || '') || undefined,
    iban: clean(client.iban || '') || undefined,
    datosContactoImportadosCCS: clean(client.datosContactoImportadosCCS || '') || undefined,
    source: clean(client.source || '') || 'ACTIVE_RECONCILE',
    sourceSheet: clean(client.sourceSheet || '') || undefined,
    rowNumber: undefined,
    rescatado: false,
    rescuedClientId: undefined,
    rescuedAt: undefined,
    rescuedBy: undefined,
    createdAt: clean(client.createdAt || nowIso),
    updatedAt: nowIso,
  };
}

async function commitInChunks(db, operations) {
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = operations.slice(i, i + BATCH_SIZE);
    chunk.forEach((op) => {
      batch.set(op.ref, op.data, { merge: true });
    });
    await batch.commit();
    if (((i / BATCH_SIZE) + 1) % 20 === 0) {
      console.log(`   ✓ chunks confirmados: ${Math.min(i + BATCH_SIZE, operations.length)}/${operations.length}`);
    }
  }
}

async function run() {
  const args = process.argv.slice(2);
  const execute = hasArg(args, '--execute');
  const syncArchive = !hasArg(args, '--skip-archive-sync');
  const confirm = parseArgValue(args, '--confirm', '');
  const limitRaw = parseArgValue(args, '--limit', '');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 0;

  if (execute && confirm !== CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Debes usar --confirm ${CONFIRM_TOKEN}`);
  }

  const app =
    getApps().find((a) => a.name === 'target-expedientes-pro-reconcile-active-clients') ||
    initializeApp(TARGET_FIREBASE_CONFIG, 'target-expedientes-pro-reconcile-active-clients');
  const db = getFirestore(app);

  const [clientsSnap, casesSnap, invoicesSnap, balancesSnap, archiveSnap] = await Promise.all([
    getDocs(collection(db, 'clients')),
    getDocs(collection(db, 'cases')),
    getDocs(collection(db, 'invoices')),
    getDocs(collection(db, 'economicBalances')),
    syncArchive ? getDocs(collection(db, 'clientArchiveIndex')) : Promise.resolve(null),
  ]);

  const nowIso = new Date().toISOString();
  const activeReasonsByClient = new Map();
  const markReason = (clientId, reason) => {
    if (!clientId) return;
    if (!activeReasonsByClient.has(clientId)) activeReasonsByClient.set(clientId, new Set());
    activeReasonsByClient.get(clientId).add(reason);
  };

  casesSnap.docs.forEach((d) => {
    const x = d.data();
    const clientId = clean(x.clienteId || x.clientId || '');
    if (clientId && detectCaseOpen(x)) markReason(clientId, 'OPEN_CASE');
  });
  invoicesSnap.docs.forEach((d) => {
    const x = d.data();
    const clientId = clean(x.clientId || '');
    if (clientId && detectPendingInvoice(x)) markReason(clientId, 'PENDING_INVOICE');
  });
  balancesSnap.docs.forEach((d) => {
    const x = d.data();
    const clientId = clean(x.clientId || '');
    if (clientId && detectBalanceWithAmount(x)) markReason(clientId, 'NON_ZERO_BALANCE');
  });

  const archiveByDocNorm = new Map();
  if (archiveSnap?.docs) {
    archiveSnap.docs.forEach((d) => {
      const x = d.data();
      const docNorm = normalizeDocumento(x.documentoNormalized || x.documento || x.nif || '');
      if (docNorm && !archiveByDocNorm.has(docNorm)) {
        archiveByDocNorm.set(docNorm, { id: d.id, ...x });
      }
    });
  }

  const clientDocs = clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const targetClients = Number.isFinite(limit) && limit > 0 ? clientDocs.slice(0, limit) : clientDocs;

  const operations = [];
  const report = {
    executedAt: nowIso,
    dryRun: !execute,
    syncArchive,
    clientsTotal: clientDocs.length,
    clientsProcessed: targetClients.length,
    activeDetected: 0,
    inactiveDetected: 0,
    clientsUpdated: 0,
    activeSet: 0,
    inactiveSet: 0,
    archiveCreated: 0,
    archiveUpdated: 0,
    unchanged: 0,
    byReason: {
      OPEN_CASE: 0,
      PENDING_INVOICE: 0,
      NON_ZERO_BALANCE: 0,
    },
  };

  targetClients.forEach((client) => {
    const reasonsSet = activeReasonsByClient.get(client.id) || new Set();
    const reasons = Array.from(reasonsSet);
    reasons.forEach((r) => {
      if (report.byReason[r] !== undefined) report.byReason[r] += 1;
    });

    const shouldBeActive = reasons.length > 0;
    if (shouldBeActive) report.activeDetected += 1;
    else report.inactiveDetected += 1;

    const prevActive = client.isActiveClient !== false;
    const prevReasons = Array.isArray(client.activeReasons) ? client.activeReasons : [];
    const prevReasonsNorm = prevReasons.slice().sort().join(',');
    const nextReasonsNorm = reasons.slice().sort().join(',');

    const needsUpdate = prevActive !== shouldBeActive || prevReasonsNorm !== nextReasonsNorm;
    if (!needsUpdate) {
      report.unchanged += 1;
    } else {
      operations.push({
        ref: doc(db, 'clients', client.id),
        data: {
          isActiveClient: shouldBeActive,
          activeReasons: reasons,
          activeStatusUpdatedAt: nowIso,
          updatedAt: nowIso,
        },
      });
      report.clientsUpdated += 1;
      if (shouldBeActive) report.activeSet += 1;
      else report.inactiveSet += 1;
    }

    if (syncArchive && !shouldBeActive) {
      const docNorm = normalizeDocumento(client.documento || client.nif || '');
      const existingArchive = docNorm ? archiveByDocNorm.get(docNorm) : null;
      if (!existingArchive) {
        const rec = buildArchiveRecord(client, nowIso);
        operations.push({
          ref: doc(db, 'clientArchiveIndex', rec.id),
          data: sanitizeUndefinedDeep(rec),
        });
        if (docNorm) archiveByDocNorm.set(docNorm, rec);
        report.archiveCreated += 1;
      } else {
        operations.push({
          ref: doc(db, 'clientArchiveIndex', existingArchive.id),
          data: { updatedAt: nowIso },
        });
        report.archiveUpdated += 1;
      }
    }
  });

  const out = {
    report,
    operations: operations.length,
  };

  const reportPath = path.resolve('/tmp', `reconcile_active_clients_report_${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(out, null, 2), 'utf8');

  console.log('\nReconciliación clientes activos ↔ histórico');
  console.log('Clientes procesados:', report.clientsProcessed, '/', report.clientsTotal);
  console.log('Activos detectados:', report.activeDetected, '| Inactivos detectados:', report.inactiveDetected);
  console.log('Clientes a actualizar:', report.clientsUpdated, '| Sin cambios:', report.unchanged);
  console.log('Sync histórico:', syncArchive ? 'SI' : 'NO');
  if (syncArchive) {
    console.log('Archive create:', report.archiveCreated, '| update:', report.archiveUpdated);
  }
  console.log('Operaciones totales:', operations.length);
  console.log('Report:', reportPath);

  if (!execute) {
    console.log('\nDRY-RUN: no se escribió nada.');
    console.log(`Para ejecutar: node scripts/reconcile-active-clients.cjs --execute --confirm ${CONFIRM_TOKEN}`);
    return;
  }

  await commitInChunks(db, operations);
  console.log('\nReconciliación completada.');
}

run().catch((error) => {
  console.error('\nError en reconciliación de clientes activos:', error.message || error);
  process.exit(1);
});
