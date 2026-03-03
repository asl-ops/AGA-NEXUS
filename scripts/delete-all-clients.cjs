#!/usr/bin/env node

/**
 * Script para eliminar TODOS los clientes de Firestore
 * Usar con precaución - esta acción no se puede deshacer
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, writeBatch, doc } = require('firebase/firestore');

const firebaseConfig = {
    apiKey: "AIzaSyC9yAYVeTCcHlLx7RRHdyTLzu-jaMGl_vo",
    authDomain: "gestor-de-expedientes-pro.firebaseapp.com",
    projectId: "gestor-de-expedientes-pro",
    storageBucket: "gestor-de-expedientes-pro.firebasestorage.app",
    messagingSenderId: "266201334385",
    appId: "1:266201334385:web:41e33a97d264660de951d0",
    measurementId: "G-QTYM3D72H2"
};

async function deleteAllClients() {
    console.log('\n🗑️  ELIMINANDO TODOS LOS CLIENTES DE FIRESTORE...\n');

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const clientsRef = collection(db, 'clients');
    const snapshot = await getDocs(clientsRef);

    console.log(`📊 Total de clientes encontrados: ${snapshot.size}`);

    if (snapshot.size === 0) {
        console.log('\n✅ No hay clientes para eliminar\n');
        return;
    }

    let deleted = 0;
    const batchSize = 500;
    const batches = Math.ceil(snapshot.size / batchSize);

    for (let i = 0; i < batches; i++) {
        const batch = writeBatch(db);
        const start = i * batchSize;
        const end = Math.min(start + batchSize, snapshot.size);

        for (let j = start; j < end; j++) {
            batch.delete(doc(db, 'clients', snapshot.docs[j].id));
            deleted++;
        }

        await batch.commit();
        console.log(`   ✓ Eliminados ${deleted}/${snapshot.size} clientes...`);
    }

    console.log(`\n✅ Todos los clientes han sido eliminados (${deleted} total)\n`);
}

deleteAllClients().catch(console.error);
