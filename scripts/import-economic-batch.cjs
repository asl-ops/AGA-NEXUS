#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
const { recalculateEconomicSummaries } = require('./lib/economic-summary-recalc.cjs');

const MASTER_CONFIRM_TOKEN = 'IMPORT_ECONOMICO_LOTE';

const TARGET_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo',
  authDomain: 'gestor-de-expedientes-pro.firebaseapp.com',
  projectId: 'gestor-de-expedientes-pro',
  storageBucket: 'gestor-de-expedientes-pro.firebasestorage.app',
  messagingSenderId: '266201334385',
  appId: '1:266201334385:web:41e33a97d264660de951d0',
};

const STEPS = [
  {
    key: 'expedientes',
    label: 'Expedientes abiertos',
    script: 'import-expedientes-abiertos-depurados.cjs',
    confirmToken: 'IMPORT_EXPEDIENTES_ABIERTOS_DEPURADOS',
    excelArgName: '--excel-expedientes',
  },
  {
    key: 'facturas',
    label: 'Facturas pendientes',
    script: 'import-facturas-pendientes-depuradas.cjs',
    confirmToken: 'IMPORT_FACTURAS_PENDIENTES_DEPURADAS',
    excelArgName: '--excel-facturas',
  },
  {
    key: 'saldos',
    label: 'Saldos contables',
    script: 'import-saldos-contables-depurados.cjs',
    confirmToken: 'IMPORT_SALDOS_CONTABLES_DEPURADOS',
    excelArgName: '--excel-saldos',
  },
  {
    key: 'mayor',
    label: 'Mayor de clientes',
    script: 'import-mayor-clientes-depurado.cjs',
    confirmToken: 'IMPORT_MAYOR_CLIENTES_DEPURADO',
    excelArgName: '--excel-mayor',
  },
];

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

function readImportReportPathFromOutput(stdoutText) {
  const lines = String(stdoutText || '').split('\n');
  for (const line of lines) {
    const m = line.match(/^Report:\s+(\/tmp\/\S+\.json)\s*$/);
    if (m) return m[1];
  }
  return '';
}

function normalizeImportReport(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return raw.report && typeof raw.report === 'object' ? raw.report : raw;
}

function runStep(step, options) {
  const args = [path.resolve(__dirname, step.script)];
  if (options.execute) {
    args.push('--execute', '--confirm', step.confirmToken);
  }
  if (options.fullSnapshot) args.push('--full-snapshot');
  if (options.skipRecalcInSteps) args.push('--skip-recalc');

  const excelPath = parseArgValue(options.rawArgs, step.excelArgName, '');
  if (excelPath) args.push('--excel', excelPath);

  console.log(`\n=== ${step.label} ===`);
  console.log(`Comando: node ${path.basename(step.script)} ${args.slice(1).join(' ')}`);

  const result = spawnSync(process.execPath, args, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 40,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    throw new Error(`Falló ${step.script} (exit=${result.status})`);
  }

  const reportPath = readImportReportPathFromOutput(result.stdout);
  let rawReport = null;
  if (reportPath && fs.existsSync(reportPath)) {
    rawReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  }
  const report = normalizeImportReport(rawReport);
  const changedClientIds = Array.isArray(report.changedClientIds) ? report.changedClientIds : [];

  return {
    key: step.key,
    label: step.label,
    reportPath,
    report,
    changedClientIds,
  };
}

async function run() {
  const args = process.argv.slice(2);
  const execute = hasArg(args, '--execute');
  const fullSnapshot = hasArg(args, '--full-snapshot');
  const skipRecalc = hasArg(args, '--skip-recalc');
  const recalcPerScript = hasArg(args, '--recalc-per-script');
  const confirm = parseArgValue(args, '--confirm', '');
  const onlyRaw = parseArgValue(args, '--only', '');
  const includeYearly = !hasArg(args, '--skip-yearly');

  if (execute && confirm !== MASTER_CONFIRM_TOKEN) {
    throw new Error(`Confirmación inválida. Usa --confirm ${MASTER_CONFIRM_TOKEN}`);
  }

  const onlySet = new Set(
    onlyRaw
      .split(',')
      .map((x) => clean(x).toLowerCase())
      .filter(Boolean)
  );
  const selectedSteps = STEPS.filter((s) => (onlySet.size > 0 ? onlySet.has(s.key) : true));
  if (selectedSteps.length === 0) throw new Error('No hay pasos seleccionados. Revisa --only');

  const startedAt = Date.now();
  const runOptions = {
    execute,
    fullSnapshot,
    skipRecalcInSteps: skipRecalc || !recalcPerScript,
    rawArgs: args,
  };

  const stepResults = [];
  for (const step of selectedSteps) {
    stepResults.push(runStep(step, runOptions));
  }

  const changedUnion = new Set();
  stepResults.forEach((r) => r.changedClientIds.forEach((id) => changedUnion.add(clean(id))));

  let consolidatedRecalc = null;
  if (execute && !skipRecalc && !recalcPerScript && changedUnion.size > 0) {
    const app =
      getApps().find((a) => a.name === 'target-expedientes-pro-import-economic-batch') ||
      initializeApp(TARGET_FIREBASE_CONFIG, 'target-expedientes-pro-import-economic-batch');
    const db = getFirestore(app);
    console.log(`\n=== Recalc consolidado (${changedUnion.size} clientes) ===`);
    consolidatedRecalc = await recalculateEconomicSummaries(db, {
      clientIds: Array.from(changedUnion),
      includeYearly,
      logPrefix: '[RECALC BATCH]',
      writeTimingLog: true,
    });
  }

  const summary = {
    executedAt: new Date().toISOString(),
    dryRun: !execute,
    mode: fullSnapshot ? 'full-snapshot' : 'incremental',
    skipRecalc,
    recalcPerScript,
    includeYearly,
    selectedSteps: selectedSteps.map((s) => s.key),
    totalDurationMs: Date.now() - startedAt,
    changedClients: Array.from(changedUnion),
    changedClientsCount: changedUnion.size,
    steps: stepResults.map((r) => ({
      key: r.key,
      label: r.label,
      reportPath: r.reportPath,
      changedRows: r.report.changedRows || 0,
      unchangedRows: r.report.unchangedRows || 0,
      softDeleted: r.report.softDeleted || 0,
      clientsChanged: r.report.clientsChanged || r.changedClientIds.length,
    })),
    consolidatedRecalc,
  };

  const summaryPath = path.resolve('/tmp', `import_economico_lote_report_${Date.now()}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log('\n=== RESUMEN LOTE ECONÓMICO ===');
  console.log('Modo:', summary.mode);
  console.log('Pasos:', summary.selectedSteps.join(', '));
  console.log('Clientes cambiados:', summary.changedClientsCount);
  if (consolidatedRecalc) {
    console.log(
      `Recalc consolidado: ${(consolidatedRecalc.totalMs / 1000).toFixed(2)}s | ` +
      `avg ${(consolidatedRecalc.avgMsPerClient / 1000).toFixed(2)}s/cliente | ` +
      `p95 ${(consolidatedRecalc.p95MsPerClient / 1000).toFixed(2)}s`
    );
  } else {
    console.log('Recalc consolidado: no ejecutado');
  }
  console.log('Reporte lote:', summaryPath);

  if (!execute) {
    console.log(
      `\nPara ejecutar en real:\n` +
      `node scripts/import-economic-batch.cjs --execute --confirm ${MASTER_CONFIRM_TOKEN}` +
      (fullSnapshot ? ' --full-snapshot' : '')
    );
  }
}

run().catch((error) => {
  console.error('\nError en import-economic-batch:', error.message || error);
  process.exit(1);
});

