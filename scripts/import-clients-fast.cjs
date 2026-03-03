#!/usr/bin/env node

/**
 * Script de Importación RÁPIDA - SIN verificación de duplicados
 * Usa esto solo para importaciones iniciales donde no hay duplicados
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, writeBatch, doc } = require('firebase/firestore');

const BATCH_SIZE = 500;

const firebaseConfig = {
    apiKey: "AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo",
    authDomain: "gestor-de-expedientes-pro.firebaseapp.com",
    projectId: "gestor-de-expedientes-pro",
    storageBucket: "gestor-de-expedientes-pro.firebasestorage.app",
    messagingSenderId: "266201334385",
    appId: "1:266201334385:web:41e33a97d264660de951d0",
    measurementId: "G-QTYM3D72H2"
};

function normalizeDocumento(doc) {
    if (!doc) return '';
    const str = String(doc).trim().toUpperCase();
    return str.replace(/[\s\-\.]/g, '');
}

function normalizeText(text) {
    if (!text) return '';
    return String(text).trim().replace(/\s+/g, ' ');
}

function inferClientType(documento) {
    if (!documento) return 'PARTICULAR';
    return /^[A-Z]/.test(documento) ? 'EMPRESA' : 'PARTICULAR';
}

function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}

function readExcelFile(filePath) {
    console.log(`\n📖 Leyendo archivo: ${filePath}`);

    if (!fs.existsSync(filePath)) {
        throw new Error(`El archivo no existe: ${filePath}`);
    }

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    console.log(`   ✓ Hoja encontrada: "${sheetName}"`);

    const rows = XLSX.utils.sheet_to_json(worksheet, {
        header: ['identificador', 'nif', 'nombre', 'domicilio', 'cuentaContable', 'iban'],
        range: 1
    });

    console.log(`   ✓ Total de filas leídas: ${rows.length}`);
    return rows;
}

function normalizeRow(row, rowNumber) {
    const nombre = normalizeText(row.nombre);
    if (!nombre) {
        return null;
    }

    const identificador = normalizeDocumento(row.identificador);
    if (!identificador) {
        return null;
    }

    const nif = normalizeDocumento(row.nif);
    const tipo = inferClientType(identificador);

    // Construir objeto base sin campos undefined
    const clientData = {
        id: generateId(),
        nombre,
        documento: identificador,
        nif: nif || identificador,
        tipo,
        estado: 'ACTIVO',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    // Solo agregar campos opcionales si tienen valor
    const direccion = normalizeText(row.domicilio);
    if (direccion) clientData.direccion = direccion;

    const cuentaContable = row.cuentaContable ? String(row.cuentaContable).trim() : '';
    if (cuentaContable) clientData.cuentaContable = cuentaContable;

    const iban = row.iban ? String(row.iban).trim() : '';
    if (iban) clientData.iban = iban;

    return clientData;
}

async function importBatchFast(db, clients, batchNumber, totalBatches) {
    const batch = writeBatch(db);

    for (const client of clients) {
        const clientRef = doc(db, 'clients', client.id);
        batch.set(clientRef, client);
    }

    await batch.commit();

    const progress = ((batchNumber / totalBatches) * 100).toFixed(1);
    console.log(`   ✓ Lote ${batchNumber}/${totalBatches} (${progress}%) - ${clients.length} clientes guardados`);
}

async function main() {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║   IMPORTACIÓN RÁPIDA - SIN VERIFICACIÓN DE DUPLICADOS    ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    const filePath = process.argv[2];
    if (!filePath) {
        console.error('❌ Error: Debes especificar la ruta del archivo Excel\n');
        process.exit(1);
    }

    const startTime = new Date();
    const report = {
        totalRows: 0,
        created: 0,
        skipped: 0
    };

    try {
        const rows = readExcelFile(filePath);
        report.totalRows = rows.length;

        console.log('\n🔄 Normalizando datos...');
        const clients = [];
        for (let i = 0; i < rows.length; i++) {
            const client = normalizeRow(rows[i], i + 2);
            if (client) {
                clients.push(client);
            } else {
                report.skipped++;
            }
        }
        console.log(`   ✓ ${clients.length} clientes válidos de ${rows.length} filas`);

        console.log('\n🔥 Conectando a Firebase...');
        const app = initializeApp(firebaseConfig);
        const db = getFirestore(app);
        console.log('   ✓ Conexión establecida');

        const totalBatches = Math.ceil(clients.length / BATCH_SIZE);
        console.log(`\n⚡ Iniciando importación RÁPIDA (${totalBatches} lotes de ${BATCH_SIZE} clientes)\n`);

        for (let i = 0; i < totalBatches; i++) {
            const start = i * BATCH_SIZE;
            const end = Math.min(start + BATCH_SIZE, clients.length);
            const batch = clients.slice(start, end);

            await importBatchFast(db, batch, i + 1, totalBatches);
        }

        report.created = clients.length;
        const duration = formatDuration(new Date() - startTime);

        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║                   REPORTE FINAL                           ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
        console.log(`📊 Total de filas procesadas:  ${report.totalRows}`);
        console.log(`✅ Clientes creados:            ${report.created}`);
        console.log(`↷  Clientes omitidos:           ${report.skipped}`);
        console.log(`⏱  Duración:                    ${duration}\n`);

        const reportPath = path.join(process.cwd(), `import-report-fast-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`📄 Reporte guardado en: ${reportPath}\n`);
        console.log('✨ Importación completada exitosamente!\n');

    } catch (error) {
        console.error('\n❌ ERROR FATAL:\n');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

main().catch(console.error);
