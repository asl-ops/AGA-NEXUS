#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, writeBatch } = require('firebase/firestore');

const SOURCE_FIREBASE_CONFIG = {
  apiKey: process.env.AGA_FIREBASE_API_KEY || 'demo',
  authDomain: process.env.AGA_FIREBASE_AUTH_DOMAIN || 'saldos-gestoria.firebaseapp.com',
  projectId: process.env.AGA_FIREBASE_PROJECT_ID || 'saldos-gestoria',
  storageBucket: process.env.AGA_FIREBASE_STORAGE_BUCKET || 'saldos-gestoria.firebasestorage.app',
  messagingSenderId: process.env.AGA_FIREBASE_MESSAGING_SENDER_ID || 'demo',
  appId: process.env.AGA_FIREBASE_APP_ID || 'demo',
};

const TARGET_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo',
  authDomain: 'gestor-de-expedientes-pro.firebaseapp.com',
  projectId: 'gestor-de-expedientes-pro',
  storageBucket: 'gestor-de-expedientes-pro.firebasestorage.app',
  messagingSenderId: '266201334385',
  appId: '1:266201334385:web:41e33a97d264660de951d0',
};

const CONFIRM_TOKEN = 'IMPORT_AGA_HISTORICO';
const BATCH_SIZE = 400;

function clean(value) {
  return String(value ?? '').trim();
}

function normalize(value) {
  return clean(value)
    .toUpperCase()
    .replace(/[\s.\-_/]/g, '');
}

function nowIso() {
  return new Date().toISOString();
}

function toIsoDate(value) {
  const txt = clean(value);
  if (!txt) return null;
  const ddmmyyyy = txt.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (ddmmyyyy) {
    const d = String(Number(ddmmyyyy[1])).padStart(2, '0');
    const m = String(Number(ddmmyyyy[2])).padStart(2, '0');
    const y = ddmmyyyy[3];
    return `${y}-${m}-${d}T00:00:00.000Z`;
  }
  const dt = new Date(txt);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  return null;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const txt = clean(value).replace(/\./g, '').replace(',', '.');
  const n = Number(txt);
  return Number.isFinite(n) ? n : 0;
}

function slug(value) {
  return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function inferCaseStatus(sourceCase) {
  const raw = clean(sourceCase.estado || sourceCase.status).toLowerCase();
  if (raw.includes('cerr')) return 'Cerrado';
  if (raw.includes('final')) return 'Cerrado';
  if (raw.includes('abier')) return 'Iniciado';

  if (clean(sourceCase.source).toUpperCase().includes('ABIERT')) return 'Iniciado';
  const saldoDebe = toNumber(sourceCase.saldoDebe);
  if (saldoDebe <= 0) return 'Cerrado';
  return 'Iniciado';
}

function inferSituation(status) {
  return status === 'Cerrado' ? 'Cerrado' : 'Iniciado';
}

function inferCategory(prefixCode) {
  const prefix = clean(prefixCode).toUpperCase();
  if (prefix.startsWith('FI')) return 'FI-TRI';
  if (prefix.startsWith('GE') || prefix.startsWith('TT') || prefix.startsWith('RE') || prefix.startsWith('LI')) return 'GE-MAT';
  return 'FI-CONTA';
}

function extractPrefixCode(fileNumber) {
  const txt = clean(fileNumber);
  if (!txt.includes('-')) return '';
  return txt.split('-')[0].trim().toUpperCase();
}

function pickClientName(sourceClient) {
  return (
    clean(sourceClient.nombre) ||
    clean(sourceClient.nombreCliente) ||
    clean(sourceClient.tituloSaldos) ||
    clean(sourceClient.razonSocial) ||
    'SIN NOMBRE'
  );
}

function parseBooleanFlag(args, name) {
  return args.includes(name);
}

function parseArgValue(args, name, defaultValue = '') {
  const idx = args.findIndex((x) => x === name);
  if (idx === -1) return defaultValue;
  return args[idx + 1] || defaultValue;
}

async function commitInChunks(ops, db) {
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = ops.slice(i, i + BATCH_SIZE);
    chunk.forEach((op) => batch.set(op.ref, op.data, { merge: true }));
    await batch.commit();
  }
}

function sameClient(a, b) {
  return (
    clean(a.nombre) === clean(b.nombre) &&
    clean(a.documento) === clean(b.documento) &&
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

async function run() {
  const args = process.argv.slice(2);
  const execute = parseBooleanFlag(args, '--execute');
  const confirm = parseArgValue(args, '--confirm');

  const sourceApp =
    getApps().find((a) => a.name === 'source-aga') || initializeApp(SOURCE_FIREBASE_CONFIG, 'source-aga');
  const targetApp =
    getApps().find((a) => a.name === 'target-expedientes-pro') || initializeApp(TARGET_FIREBASE_CONFIG, 'target-expedientes-pro');

  const sourceDb = getFirestore(sourceApp);
  const targetDb = getFirestore(targetApp);

  const [sourceClientsSnap, sourceCasesSnap, targetClientsSnap, targetCasesSnap, prefixesSnap] = await Promise.all([
    getDocs(collection(sourceDb, 'clientes')),
    getDocs(collection(sourceDb, 'expedientes')),
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

  const transformedClients = [];
  sourceClientsSnap.docs.forEach((d) => {
    const s = d.data();
    const documento = clean(s.identificador || s.documento || s.nif);
    const cuentaContable = clean(s.cuentaContable || s.cuenta);
    const nombre = pickClientName(s);
    if (!documento && !cuentaContable) return;
    const stableId = `aga_${slug(documento || cuentaContable || d.id)}`;
    transformedClients.push({
      id: stableId,
      nombre,
      documento: documento || undefined,
      nif: documento || undefined,
      cuentaContable: cuentaContable || undefined,
      estado: 'ACTIVO',
      tipo: documento && /^[A-Z]/.test(documento) ? 'EMPRESA' : 'PARTICULAR',
      telefono: clean(s.telefono) || undefined,
      email: clean(s.email) || undefined,
      direccion: clean(s.direccion || s.domicilioCompleto) || undefined,
      poblacion: clean(s.poblacion) || undefined,
      provincia: clean(s.provincia) || undefined,
      iban: clean(s.iban || s.codigoIban) || undefined,
      source: 'AGA',
      sourceClientId: d.id,
      updatedAt: nowIso(),
      createdAt: nowIso(),
    });
  });

  const transformedCases = [];
  sourceCasesSnap.docs.forEach((d) => {
    const s = d.data();
    const fileNumber = clean(s.expediente || s.expedienteId || s.numero || d.id).toUpperCase();
    if (!fileNumber) return;

    const prefixCode = extractPrefixCode(fileNumber);
    const prefixIdCandidate = prefixCode ? `prefix_${prefixCode}` : '';
    const prefixId = validPrefixIds.has(prefixIdCandidate) ? prefixIdCandidate : undefined;

    const documento = clean(s.identificador);
    const cuentaContable = clean(s.cuentaContable);
    const linkedClient =
      byDocumento.get(normalize(documento)) ||
      byCuenta.get(cuentaContable) ||
      targetClients.find((c) => normalize(c.documento || c.nif) === normalize(documento));

    const linkedClientId = linkedClient?.id || (documento ? `aga_${slug(documento)}` : `aga_${slug(cuentaContable || s.clienteId || d.id)}`);
    const clientName = clean(s.nombreCliente) || linkedClient?.nombre || 'SIN NOMBRE';
    const status = inferCaseStatus(s);
    const createdAt = toIsoDate(s.fechaApertura) || nowIso();

    transformedCases.push({
      fileNumber,
      clienteId: linkedClientId,
      clientSnapshot: {
        id: linkedClientId,
        nombre: clientName,
        documento: documento || linkedClient?.documento || '',
      },
      client: {
        id: linkedClientId,
        surnames: '',
        firstName: clientName,
        nif: documento || linkedClient?.documento || '',
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
        fileType: clean(s.tipo || s.expedienteTipo) || '',
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
      createdAt,
      updatedAt: nowIso(),
      closedAt: status === 'Cerrado' ? nowIso() : undefined,
      situation: inferSituation(status),
      source: 'AGA',
      sourceCaseId: d.id,
      sourceSaldoDebe: toNumber(s.saldoDebe),
      sourceFechaAperturaRaw: clean(s.fechaApertura),
    });
  });

  const clientPlan = {
    create: [],
    update: [],
    unchanged: 0,
  };

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

  const casePlan = {
    create: [],
    update: [],
    unchanged: 0,
  };

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
    sourceProject: SOURCE_FIREBASE_CONFIG.projectId,
    targetProject: TARGET_FIREBASE_CONFIG.projectId,
    sourceCounts: {
      clients: sourceClientsSnap.size,
      cases: sourceCasesSnap.size,
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

  const reportPath = path.resolve('/tmp', `import_aga_historico_report_${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('\nImportador AGA -> Expedientes Pro');
  console.log('Origen:', SOURCE_FIREBASE_CONFIG.projectId, '| Destino:', TARGET_FIREBASE_CONFIG.projectId);
  console.log('Source clients:', sourceClientsSnap.size, '| Source cases:', sourceCasesSnap.size);
  console.log('Plan clients => create:', clientPlan.create.length, 'update:', clientPlan.update.length, 'unchanged:', clientPlan.unchanged);
  console.log('Plan cases   => create:', casePlan.create.length, 'update:', casePlan.update.length, 'unchanged:', casePlan.unchanged);
  console.log('Report:', reportPath);

  if (!execute) {
    console.log('\nDRY-RUN: no se escribieron datos.');
    console.log(`Para ejecutar: node scripts/import-aga-historico-to-expedientes-pro.cjs --execute --confirm ${CONFIRM_TOKEN}`);
    return;
  }

  if (confirm !== CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Debes pasar --confirm ${CONFIRM_TOKEN}`);
  }

  const ops = [];
  clientPlan.create.forEach((c) => {
    ops.push({ ref: doc(targetDb, 'clients', c.id), data: c });
  });
  clientPlan.update.forEach((c) => {
    ops.push({ ref: doc(targetDb, 'clients', c.id), data: { ...c.data, updatedAt: nowIso() } });
  });
  casePlan.create.forEach((c) => {
    ops.push({ ref: doc(targetDb, 'cases', c.fileNumber), data: c });
  });
  casePlan.update.forEach((c) => {
    ops.push({ ref: doc(targetDb, 'cases', c.id), data: { ...c.data, updatedAt: nowIso() } });
  });

  await commitInChunks(ops, targetDb);

  const [afterClients, afterCases] = await Promise.all([
    getDocs(collection(targetDb, 'clients')),
    getDocs(collection(targetDb, 'cases')),
  ]);

  console.log('\nImportación completada.');
  console.log('Target clients:', afterClients.size, '| Target cases:', afterCases.size);
}

run().catch((error) => {
  console.error('\nError importando histórico AGA:', error.message || error);
  process.exit(1);
});
