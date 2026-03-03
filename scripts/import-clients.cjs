#!/usr/bin/env node

/**
 * Script de Importación Masiva de Clientes desde Excel
 * 
 * Uso:
 *   npm run import-clients <ruta-al-archivo.xlsx>
 * 
 * Ejemplo:
 *   npm run import-clients ~/Desktop/clientes-gestoria.xlsx
 * 
 * Formato esperado del Excel:
 *   Columna A: Identificador (documento/NIF)
 *   Columna B: NIF
 *   Columna C: Nombre completo
 *   Columna D: Domicilio completo
 *   Columna E: Cuenta contable
 *   Columna F: Código IBAN
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, writeBatch, doc } = require('firebase/firestore');

// =====================================================
// CONFIGURACIÓN
// =====================================================

const BATCH_SIZE = 500;
const FIRESTORE_BATCH_LIMIT = 500;
const DELAY_BETWEEN_BATCHES_MS = 1000;

const firebaseConfig = {
    apiKey: "AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo",
    authDomain: "gestor-de-expedientes-pro.firebaseapp.com",
    projectId: "gestor-de-expedientes-pro",
    storageBucket: "gestor-de-expedientes-pro.firebasestorage.app",
    messagingSenderId: "266201334385",
    appId: "1:266201334385:web:41e33a97d264660de951d0",
    measurementId: "G-QTYM3D72H2"
};

// =====================================================
// UTILIDADES
// =====================================================

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
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================================================
// LÓGICA DE IMPORTACIÓN
// =====================================================

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
        console.warn(`   ⚠️  Fila ${rowNumber}: nombre vacío, se omitirá`);
        return null;
    }

    const identificador = normalizeDocumento(row.identificador);
    if (!identificador) {
        console.warn(`   ⚠️  Fila ${rowNumber}: identificador vacío, se omitirá`);
        return null;
    }

    const nif = normalizeDocumento(row.nif);
    const tipo = inferClientType(identificador);

    // Construir objeto base
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

async function findExistingClient(db, documento) {
    const clientsRef = collection(db, 'clients');
    const q = query(clientsRef, where('documento', '==', documento));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
        return snapshot.docs[0].id;
    }

    return null;
}

async function importBatch(db, clients, batchNumber, totalBatches, report, duplicatePolicy) {
    console.log(`\n📦 Procesando lote ${batchNumber}/${totalBatches} (${clients.length} clientes)`);

    const batch = writeBatch(db);
    let batchOperations = 0;

    for (let i = 0; i < clients.length; i++) {
        const client = clients[i];
        const rowNumber = (batchNumber - 1) * BATCH_SIZE + i + 2;

        try {
            const existingId = await findExistingClient(db, client.documento);

            if (existingId) {
                if (duplicatePolicy === 'IGNORE') {
                    console.log(`   ↷ Fila ${rowNumber}: "${client.nombre}" ya existe (ignorado)`);
                    report.skipped++;
                } else {
                    // UPDATE: actualizar cliente existente (sin campos undefined)
                    const updateData = { ...client };
                    updateData.id = existingId; // Mantener ID original
                    updateData.updatedAt = new Date().toISOString();

                    const clientRef = doc(db, 'clients', existingId);
                    batch.update(clientRef, updateData);
                    batchOperations++;
                    report.updated++;
                    console.log(`   ↻ Fila ${rowNumber}: "${client.nombre}" actualizado`);
                }
            } else {
                const clientRef = doc(db, 'clients', client.id);
                batch.set(clientRef, client);
                batchOperations++;
                report.created++;
                console.log(`   ✓ Fila ${rowNumber}: "${client.nombre}" creado`);
            }

            if (batchOperations >= FIRESTORE_BATCH_LIMIT) {
                await batch.commit();
                console.log(`   💾 Batch guardado (${batchOperations} operaciones)`);
                batchOperations = 0;
            }

        } catch (error) {
            report.errors++;
            report.errorDetails.push({
                row: rowNumber,
                error: error instanceof Error ? error.message : String(error),
                data: client
            });
            console.error(`   ✗ Fila ${rowNumber}: Error - ${error instanceof Error ? error.message : error}`);
        }
    }

    if (batchOperations > 0) {
        await batch.commit();
        console.log(`   💾 Batch final guardado (${batchOperations} operaciones)`);
    }

    if (batchNumber < totalBatches) {
        console.log(`   ⏸  Esperando ${DELAY_BETWEEN_BATCHES_MS}ms...`);
        await delay(DELAY_BETWEEN_BATCHES_MS);
    }
}

async function main() {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║   IMPORTACIÓN MASIVA DE CLIENTES - Gestoría AZ-98        ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    const filePath = process.argv[2];
    if (!filePath) {
        console.error('❌ Error: Debes especificar la ruta del archivo Excel\n');
        console.log('Uso:');
        console.log('  npm run import-clients <ruta-al-archivo.xlsx>\n');
        console.log('Ejemplo:');
        console.log('  npm run import-clients ~/Desktop/clientes.xlsx\n');
        process.exit(1);
    }

    const duplicatePolicy = process.argv[3]?.toUpperCase() === 'UPDATE' ? 'UPDATE' : 'IGNORE';
    console.log(`📋 Política de duplicados: ${duplicatePolicy === 'IGNORE' ? 'Ignorar' : 'Actualizar'}`);

    const report = {
        totalRows: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        errorDetails: [],
        startTime: new Date()
    };

    try {
        const rows = readExcelFile(filePath);
        report.totalRows = rows.length;

        if (rows.length === 0) {
            throw new Error('El archivo Excel está vacío');
        }

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
        console.log(`\n📊 Iniciando importación (${totalBatches} lotes de ~${BATCH_SIZE} clientes)`);

        for (let i = 0; i < totalBatches; i++) {
            const start = i * BATCH_SIZE;
            const end = Math.min(start + BATCH_SIZE, clients.length);
            const batch = clients.slice(start, end);

            await importBatch(db, batch, i + 1, totalBatches, report, duplicatePolicy);
        }

        report.endTime = new Date();
        report.duration = formatDuration(report.endTime.getTime() - report.startTime.getTime());

        console.log('\n\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║                   REPORTE FINAL                           ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
        console.log(`📊 Total de filas procesadas:  ${report.totalRows}`);
        console.log(`✅ Clientes creados:            ${report.created}`);
        console.log(`↻  Clientes actualizados:       ${report.updated}`);
        console.log(`↷  Clientes omitidos:           ${report.skipped}`);
        console.log(`❌ Errores:                     ${report.errors}`);
        console.log(`⏱  Duración:                    ${report.duration}\n`);

        if (report.errorDetails.length > 0) {
            console.log('⚠️  DETALLES DE ERRORES:\n');
            report.errorDetails.forEach(({ row, error }) => {
                console.log(`   Fila ${row}: ${error}`);
            });
            console.log('');
        }

        const reportPath = path.join(process.cwd(), `import-report-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`📄 Reporte guardado en: ${reportPath}\n`);

        console.log('✨ Importación completada exitosamente!\n');

    } catch (error) {
        console.error('\n❌ ERROR FATAL:\n');
        console.error(error instanceof Error ? error.message : error);
        console.error('');
        process.exit(1);
    }
}

main().catch(console.error);
