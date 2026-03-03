#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const XLSX = require('xlsx');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, writeBatch, query, where } = require('firebase/firestore');
const { recalculateEconomicSummaries } = require('./lib/economic-summary-recalc.cjs');

const TARGET_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo',
  authDomain: 'gestor-de-expedientes-pro.firebaseapp.com',
  projectId: 'gestor-de-expedientes-pro',
  storageBucket: 'gestor-de-expedientes-pro.firebasestorage.app',
  messagingSenderId: '266201334385',
  appId: '1:266201334385:web:41e33a97d264660de951d0',
};

const DEFAULT_EXCEL_PATH =
  '/Users/antoniosanchez/Library/Mobile Documents/com~apple~CloudDocs/AATRASPASOS/FACTURAS PENDIENTES DEPURADAS.xlsx';
const CONFIRM_TOKEN = 'IMPORT_FACTURAS_PENDIENTES_DEPURADAS';
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
  const v = normalizeText(value);
  if (!v) return '';
  const stripped = v.replace(/[\s\-.,_/]/g, '');
  if (!stripped || stripped === ',') return '';
  return stripped;
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

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(2));
  const txt = clean(value);
  if (!txt) return NaN;
  const normalized = txt.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return NaN;
  return Number(n.toFixed(2));
}

function parseDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const y = String(parsed.y).padStart(4, '0');
    const m = String(parsed.m).padStart(2, '0');
    const d = String(parsed.d).padStart(2, '0');
    return `${y}-${m}-${d}T00:00:00.000Z`;
  }

  const txt = clean(value);
  if (!txt) return null;

  const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`;

  const es = txt.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (es) {
    const d = String(Number(es[1])).padStart(2, '0');
    const m = String(Number(es[2])).padStart(2, '0');
    const y = es[3];
    return `${y}-${m}-${d}T00:00:00.000Z`;
  }

  const dt = new Date(txt);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  return null;
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

function fingerprint(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
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
        const backoff = Math.min(20000, 500 * 2 ** retry);
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
    await wait(60);
  }
}

async function run() {
  const args = process.argv.slice(2);
  const execute = hasArg(args, '--execute');
  const skipRecalc = hasArg(args, '--skip-recalc');
  const fullSnapshot = hasArg(args, '--full-snapshot');
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
  const idxCliente = resolveColumnIndex(headers, ['Cliente', 'Identificador'], 1);
  const idxNombre = resolveColumnIndex(headers, ['Nombre', 'Nombre cliente'], 2);
  const idxFactura = resolveColumnIndex(headers, ['Factura', 'Num factura', 'Número factura'], 3);
  const idxFecha = resolveColumnIndex(headers, ['Fec. factura', 'Fecha factura', 'Fecha'], 4);
  const idxSituacion = resolveColumnIndex(headers, ['Situación', 'Situacion', 'Estado'], 5);
  const idxImpNeto = resolveColumnIndex(headers, ['Imp. neto', 'Importe neto', 'Importe'], 6);

  const app =
    getApps().find((a) => a.name === 'target-expedientes-pro-facturas-pendientes') ||
    initializeApp(TARGET_FIREBASE_CONFIG, 'target-expedientes-pro-facturas-pendientes');
  const db = getFirestore(app);

  const [clientsSnap, archiveSnap, invoicesSnap] = await Promise.all([
    getDocs(collection(db, 'clients')),
    getDocs(collection(db, 'clientArchiveIndex')),
    getDocs(collection(db, 'invoices')),
  ]);

  const clientsByDocumento = new Map();
  clientsSnap.docs.forEach((d) => {
    const data = d.data();
    const docNorm = normalizeDocumento(data.documento || data.nif || '');
    if (docNorm && !clientsByDocumento.has(docNorm)) {
      clientsByDocumento.set(docNorm, { id: d.id, ...data });
    }
  });

  const archiveByDocumento = new Map();
  archiveSnap.docs.forEach((d) => {
    const data = d.data();
    const docNorm = normalizeDocumento(data.documentoNormalized || data.documento || data.nif || '');
    if (docNorm && !archiveByDocumento.has(docNorm)) {
      archiveByDocumento.set(docNorm, { id: d.id, ...data });
    }
  });

  const invoicesByNumber = new Map();
  invoicesSnap.docs.forEach((d) => {
    const data = d.data();
    const num = clean(data.number || '');
    if (num && !invoicesByNumber.has(num)) invoicesByNumber.set(num, { id: d.id, ...data });
  });

  const now = new Date().toISOString();
  const operations = [];
  const changedClientIds = new Set();
  const rescuedClients = new Set();
  const createdFallbackClients = new Set();

  const report = {
    sourceRows: rows.length - 1,
    parsedRows: 0,
    skippedRows: 0,
    rescuedFromArchive: 0,
    fallbackCreated: 0,
    invoicesCreate: 0,
    invoicesUpdate: 0,
    missingArchive: [],
    parseErrors: [],
    mode: fullSnapshot ? 'full-snapshot' : 'incremental',
    softDeleted: 0,
    unchangedRows: 0,
    changedRows: 0,
    clientsChanged: 0,
  };
  const seenInvoiceDocIds = new Set();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const rawCliente = pickCell(row, idxCliente);
    const rawNombre = pickCell(row, idxNombre);
    const rawFactura = pickCell(row, idxFactura);
    const rawFecha = pickCell(row, idxFecha);
    const rawSituacion = pickCell(row, idxSituacion);
    const rawImporte = row[idxImpNeto];

    const documentoNorm = normalizeDocumento(rawCliente);
    const facturaNumber = clean(rawFactura);
    const amount = parseNumber(rawImporte);
    const issuedAt = parseDate(rawFecha) || now;

    if (!documentoNorm || !facturaNumber || !Number.isFinite(amount)) {
      report.skippedRows += 1;
      report.parseErrors.push({
        row: i + 1,
        documento: rawCliente,
        factura: rawFactura,
        importe: rawImporte
      });
      continue;
    }

    report.parsedRows += 1;

    let client = clientsByDocumento.get(documentoNorm);
    if (!client) {
      const archive = archiveByDocumento.get(documentoNorm);
      if (archive) {
        const rescuedId = archive.rescuedClientId || `cli_${slug(documentoNorm)}`;
        if (!rescuedClients.has(rescuedId) && !clientsByDocumento.has(documentoNorm)) {
          const rescuedClientPayload = sanitizeUndefinedDeep({
            id: rescuedId,
            nombre: clean(archive.nombre || rawNombre || `CLIENTE ${documentoNorm}`),
            documento: normalizeDocumento(archive.documento || archive.nif || documentoNorm),
            nif: normalizeDocumento(archive.nif || archive.documento || documentoNorm),
            tipo: /^[A-Z]/.test(documentoNorm) ? 'EMPRESA' : 'PARTICULAR',
            estado: 'ACTIVO',
            direccion: clean(archive.direccion) || undefined,
            poblacion: clean(archive.poblacion) || undefined,
            provincia: clean(archive.provincia) || undefined,
            cuentaContable: clean(archive.cuentaContable) || undefined,
            iban: clean(archive.iban) || undefined,
            datosContactoImportadosCCS: clean(archive.datosContactoImportadosCCS) || undefined,
            source: 'ARCHIVE_RESCUE_FACTURAS_DEPURADAS',
            updatedAt: now,
            createdAt: clean(archive.createdAt) || now,
          });
          operations.push({ ref: doc(db, 'clients', rescuedId), data: rescuedClientPayload });
          operations.push({
            ref: doc(db, 'clientArchiveIndex', archive.id),
            data: {
              rescatado: true,
              rescuedClientId: rescuedId,
              rescuedAt: now,
              rescuedBy: 'import-facturas-pendientes-depuradas',
              updatedAt: now,
            }
          });
          rescuedClients.add(rescuedId);
          report.rescuedFromArchive += 1;
          client = rescuedClientPayload;
          clientsByDocumento.set(documentoNorm, client);
        } else {
          client = clientsByDocumento.get(documentoNorm) || { id: rescuedId, ...archive };
        }
      } else {
        // Fallback de seguridad: crear cliente mínimo si no existe en almacén.
        const fallbackId = `cli_${slug(documentoNorm)}`;
        if (!createdFallbackClients.has(fallbackId) && !clientsByDocumento.has(documentoNorm)) {
          const fallbackClientPayload = {
            id: fallbackId,
            nombre: clean(rawNombre || `CLIENTE ${documentoNorm}`),
            documento: documentoNorm,
            nif: documentoNorm,
            tipo: /^[A-Z]/.test(documentoNorm) ? 'EMPRESA' : 'PARTICULAR',
            estado: 'ACTIVO',
            source: 'FACTURAS_PENDIENTES_FALLBACK',
            updatedAt: now,
            createdAt: now,
          };
          operations.push({ ref: doc(db, 'clients', fallbackId), data: fallbackClientPayload });
          createdFallbackClients.add(fallbackId);
          report.fallbackCreated += 1;
          report.missingArchive.push({ row: i + 1, documento: documentoNorm, factura: facturaNumber });
          client = fallbackClientPayload;
          clientsByDocumento.set(documentoNorm, client);
        } else {
          client = clientsByDocumento.get(documentoNorm) || { id: fallbackId, nombre: rawNombre || fallbackId };
        }
      }
    }
    const invoiceId = `inv_${slug(`${facturaNumber}_${documentoNorm}`)}`;
    const invoiceCore = sanitizeUndefinedDeep({
      id: invoiceId,
      number: facturaNumber,
      status: 'issued',
      createdAt: issuedAt,
      issuedAt,
      updatedAt: now,
      clientId: client?.id || null,
      clientName: clean(rawNombre || client?.nombre || ''),
      clientIdentity: documentoNorm,
      lines: [
        {
          concept: 'Factura pendiente importada',
          quantity: 1,
          unitPrice: amount,
          amount,
          vatRate: 0,
          vatAmount: 0,
        }
      ],
      subtotal: amount,
      vatTotal: 0,
      total: amount,
      isPaid: false,
      notes: `Importada desde FACTURAS PENDIENTES DEPURADAS · Situación: ${clean(rawSituacion || 'Pendiente')}`,
      source: 'FACTURAS_PENDIENTES_DEPURADAS',
      sourceSheet: targetSheetName,
      situationOriginal: clean(rawSituacion || 'Pendiente'),
    });
    const fp = fingerprint({
      number: invoiceCore.number,
      clientId: invoiceCore.clientId,
      clientIdentity: invoiceCore.clientIdentity,
      issuedAt: invoiceCore.issuedAt,
      total: invoiceCore.total,
      isPaid: invoiceCore.isPaid,
      source: invoiceCore.source,
      situationOriginal: invoiceCore.situationOriginal,
    });
    const invoicePayload = sanitizeUndefinedDeep({
      ...invoiceCore,
      __fp: fp,
      softDeleted: false,
      isActive: true,
      deletedAt: null,
      deletedBy: null,
    });

    if (invoicesByNumber.has(facturaNumber)) {
      const existing = invoicesByNumber.get(facturaNumber);
      const oldFp = clean(existing.__fp || '');
      const wasSoftDeleted = existing.softDeleted === true || existing.isActive === false;
      if (oldFp === fp && !wasSoftDeleted) {
        report.unchangedRows += 1;
      } else {
        operations.push({ ref: doc(db, 'invoices', existing.id), data: invoicePayload });
        report.changedRows += 1;
        if (client?.id) changedClientIds.add(client.id);
        const prevClientId = clean(existing.clientId || '');
        if (prevClientId) changedClientIds.add(prevClientId);
      }
      seenInvoiceDocIds.add(existing.id);
      report.invoicesUpdate += 1;
    } else {
      operations.push({ ref: doc(db, 'invoices', invoiceId), data: invoicePayload });
      invoicesByNumber.set(facturaNumber, { id: invoiceId, ...invoicePayload });
      seenInvoiceDocIds.add(invoiceId);
      report.invoicesCreate += 1;
      report.changedRows += 1;
      if (client?.id) changedClientIds.add(client.id);
    }
  }

  if (fullSnapshot) {
    const existingSourceSnap = await getDocs(
      query(collection(db, 'invoices'), where('source', '==', 'FACTURAS_PENDIENTES_DEPURADAS'))
    );
    existingSourceSnap.docs.forEach((d) => {
      if (!seenInvoiceDocIds.has(d.id)) {
        const prev = d.data();
        if (!(prev.softDeleted === true || prev.isActive === false)) {
          operations.push({
            ref: doc(db, 'invoices', d.id),
            data: sanitizeUndefinedDeep({
              softDeleted: true,
              deletedAt: now,
              deletedBy: 'import-facturas-pendientes-depuradas--full-snapshot',
              isActive: false,
              updatedAt: now,
            }),
          });
          report.softDeleted += 1;
          report.changedRows += 1;
          const affectedClientId = clean(prev.clientId || '');
          if (affectedClientId) changedClientIds.add(affectedClientId);
        }
      }
    });
  }
  report.clientsChanged = changedClientIds.size;
  report.changedClientIds = Array.from(changedClientIds).sort();

  const summary = {
    executedAt: now,
    dryRun: !execute,
    excelPath,
    sheet: targetSheetName,
    headers,
    report,
    operations: operations.length,
  };

  const reportPath = path.resolve('/tmp', `import_facturas_pendientes_depuradas_report_${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log('\nImportador FACTURAS PENDIENTES DEPURADAS');
  console.log('Modo importación:', fullSnapshot ? 'FULL SNAPSHOT (soft-delete ausentes)' : 'INCREMENTAL');
  console.log('Excel:', excelPath);
  console.log('Hoja:', targetSheetName);
  console.log('Filas origen:', report.sourceRows, '| Parseadas:', report.parsedRows, '| Omitidas:', report.skippedRows);
  console.log('Clientes rescatados de almacén:', report.rescuedFromArchive, '| fallback:', report.fallbackCreated);
  console.log('Facturas -> create:', report.invoicesCreate, 'update:', report.invoicesUpdate);
  if (fullSnapshot) console.log('Facturas soft-delete:', report.softDeleted);
  console.log('Operaciones de escritura:', operations.length);
  console.log('Report:', reportPath);

  if (!execute) {
    console.log('\nDRY-RUN: no se escribieron datos.');
    console.log(
      `Para ejecutar: node scripts/import-facturas-pendientes-depuradas.cjs --execute --confirm ${CONFIRM_TOKEN}` +
      (fullSnapshot ? ' --full-snapshot' : '')
    );
    return;
  }

  if (confirm !== CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Debes usar --confirm ${CONFIRM_TOKEN}`);
  }

  await commitInChunks(db, operations);

  let recalc = null;
  if (!skipRecalc && changedClientIds.size > 0) {
    console.log(`\nRecalculando sumarios económicos para ${changedClientIds.size} clientes realmente cambiados...`);
    recalc = await recalculateEconomicSummaries(db, {
      clientIds: Array.from(changedClientIds),
      includeYearly: true,
      logPrefix: '[RECALC FACTURAS]',
      writeTimingLog: true,
    });
    summary.recalc = recalc;
    fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log('Recalc report:', recalc.reportPath || '(sin ruta)');
  }

  const [afterClients, afterInvoices] = await Promise.all([
    getDocs(collection(db, 'clients')),
    getDocs(collection(db, 'invoices')),
  ]);
  console.log('\nImportación completada.');
  console.log('Clients actuales:', afterClients.size, '| Invoices actuales:', afterInvoices.size);
  if (recalc) {
    console.log(
      `Recalc tiempo total: ${(recalc.totalMs / 1000).toFixed(2)}s | avg: ${(recalc.avgMsPerClient / 1000).toFixed(2)}s/cliente | p95: ${(recalc.p95MsPerClient / 1000).toFixed(2)}s`
    );
  }
}

run().catch((error) => {
  console.error('\nError importando FACTURAS PENDIENTES DEPURADAS:', error.message || error);
  process.exit(1);
});
