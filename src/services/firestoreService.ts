import { CaseRecord, Client, EconomicTemplates, AppSettings, Vehicle, DEFAULT_CASE_STATUSES, FileCategory, MovimientoExpediente, RegimenIVA, EstadoMovimiento, Naturaleza } from '@/types';
import { getPrefijoMovimientos } from './prefijoMovimientoService';
import { getMovimientoById } from './movimientoService';
import { roundToTwo } from '@/utils/fiscalUtils';
import { INITIAL_ECONOMIC_TEMPLATES } from './templates';
import { DEFAULT_MANDATO_BODY } from './templateContent';
import { db } from './firebase';
import {
    collection,
    doc,
    getDocs,
    getDoc,
    setDoc,
    deleteDoc,
    updateDoc,
    writeBatch,
    query,
    where
} from 'firebase/firestore';

const caseCollection = collection(db, 'cases');
const clientCollection = collection(db, 'clients');
const vehicleCollection = collection(db, 'vehicles');
const usersCollection = collection(db, 'users');
const settingsDoc = doc(db, 'settings', 'app-settings');
const templatesDoc = doc(db, 'economicTemplates', 'default');


export const getCaseHistory = async (): Promise<CaseRecord[]> => {
    const snapshot = await getDocs(caseCollection);
    return snapshot.docs.map(doc => doc.data() as CaseRecord);
};

/**
 * 🆕 Obtiene expedientes de un cliente específico (sistema centralizado)
 */
export const getCasesByClientId = async (clientId: string): Promise<CaseRecord[]> => {
    const q = query(caseCollection, where('clienteId', '==', clientId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data() as CaseRecord);
};

export const saveOrUpdateCase = async (caseRecord: CaseRecord): Promise<{ updatedHistory: CaseRecord[], isNew: boolean }> => {
    const caseDocRef = doc(db, 'cases', caseRecord.fileNumber);
    const caseDoc = await getDoc(caseDocRef);
    const isNew = !caseDoc.exists();

    const serializableRecord = {
        ...caseRecord,
        attachments: caseRecord.attachments.map(({ file, ...rest }) => rest),
    };

    const recordToSave: CaseRecord = {
        ...serializableRecord,
        updatedAt: new Date().toISOString(),
        createdAt: isNew ? new Date().toISOString() : (caseRecord.createdAt || new Date().toISOString()),
    };

    // Sanitize undefined values (Firestore doesn't like them)
    const sanitizedData = JSON.parse(JSON.stringify(recordToSave));

    // Remove nulls that might have been undefined or explicitly null but we want to be safe
    // Actually, Firestore accepts nulls, but NOT undefined.
    // JSON.stringify removes undefined values by default.

    await setDoc(caseDocRef, sanitizedData, { merge: true });

    const updatedHistory = await getCaseHistory();
    return { updatedHistory, isNew };
};

export const deleteCase = async (fileNumber: string): Promise<CaseRecord[]> => {
    const caseDocRef = doc(db, 'cases', fileNumber);
    await deleteDoc(caseDocRef);
    return getCaseHistory();
};

export const saveMultipleCases = async (cases: CaseRecord[]): Promise<CaseRecord[]> => {
    const batch = writeBatch(db);
    const now = new Date().toISOString();

    const serializableCases = cases.map(caseRecord => {
        // Create a shallow copy to modify
        const docData = { ...caseRecord };

        // Handle attachments (strip file objects)
        docData.attachments = caseRecord.attachments.map(({ file, ...rest }) => rest);

        // Update timestamps
        docData.updatedAt = now;
        // Only set createdAt if it doesn't exist (handle new cases vs updates)
        if (!docData.createdAt) {
            docData.createdAt = now;
        }

        // Sanitize undefined values (Firestore doesn't like them)
        Object.keys(docData).forEach(key => {
            const k = key as keyof CaseRecord;
            if (docData[k] === undefined) {
                delete docData[k];
            }
        });

        return docData;
    });

    serializableCases.forEach(c => {
        const docRef = doc(db, 'cases', c.fileNumber);
        batch.set(docRef, c);
    });

    await batch.commit();
    return getCaseHistory();
};

export const getNextFileNumber = async (prefix: string = 'EXP'): Promise<string> => {
    const allCases = await getCaseHistory();

    // Filter cases that start with the specified prefix
    const casesWithPrefix = allCases.filter(c => c.fileNumber.startsWith(prefix + '-'));

    const sortedCases = casesWithPrefix.sort((a, b) => b.fileNumber.localeCompare(a.fileNumber, undefined, { numeric: true, sensitivity: 'base' }));

    let nextNum = 1;
    if (sortedCases.length > 0) {
        const lastFileNumber = sortedCases[0].fileNumber;
        const match = lastFileNumber.match(/-(\d+)$/);
        if (match) {
            nextNum = parseInt(match[1], 10) + 1;
        }
    }

    return `${prefix}-${String(nextNum).padStart(4, '0')}`;
};

export const createNewCase = async (
    category: FileCategory,
    subType?: string,
    forcedFileNumber?: string,
    responsibleId?: string,
    clienteId?: string,
    clientSnapshot?: any,
    prefixId?: string,
    options?: {
        deferMovementInitialization?: boolean;
    }
): Promise<CaseRecord> => {
    const fileNumber = forcedFileNumber || await getNextFileNumber(category);
    const shouldDeferMovements = options?.deferMovementInitialization === true;

    // Initial movements from prefix (if provided) - ATOMIC INITIALIZATION
    let initialMovements: MovimientoExpediente[] = [];
    if (prefixId && !shouldDeferMovements) {
        try {
            const predefined = await getPrefijoMovimientos(prefixId);
            initialMovements = await Promise.all(predefined.map(async (p, idx) => {
                let finalImporte = p.importePorDefecto || 0;

                // Si el importe en el enlace es 0/null, intentamos recuperar el del catálogo maestro
                if (!finalImporte && prefixId) {
                    try {
                        const masterMov = await getMovimientoById(prefixId, p.movimientoId);
                        if (masterMov && masterMov.importePorDefecto) {
                            finalImporte = masterMov.importePorDefecto;
                        }
                    } catch (err) {
                        console.warn('Error fetching master movement for fallback amount:', p.movimientoId);
                    }
                }

                return {
                    id: `mov_${Date.now()}_${idx}`,
                    expedienteId: fileNumber,
                    movimientoId: p.movimientoId,
                    orden: p.orden,
                    nombreSnapshot: p.nombre || '',
                    codigoSnapshot: (p as any).codigo || '',
                    naturalezaSnapshot: (p as any).naturaleza || Naturaleza.OTRO,
                    descripcionOverride: p.nombre || '',
                    importe: roundToTwo(finalImporte),
                    regimenIva: (p as any).regimenIva || RegimenIVA.SUJETO,
                    ivaPorcentaje: (p as any).ivaPorcentaje || 21,
                    estado: EstadoMovimiento.REALIZADO,
                    facturable: p.categoria === 'OPERATIVO',
                    fecha: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            }));
        } catch (e) {
            console.error('CRITICAL: Error loading initial movements for new case:', e);
            throw new Error(`No se pudo inicializar el expediente: Error al cargar movimientos del prefijo. ${e instanceof Error ? e.message : ''}`);
        }
    }

    const newCase: CaseRecord = {
        fileNumber,
        clienteId: clienteId || null,
        clientSnapshot: clientSnapshot || null,
        client: {
            id: '', nombre: '', surnames: '', firstName: '', nif: '', address: '',
            city: '', province: '', postalCode: '', phone: '', email: '',
        },
        vehicle: {
            vin: '', brand: '', model: '', year: '', engineSize: '', fuelType: '',
        },
        fileConfig: {
            fileType: subType || '',
            category: category,
            responsibleUserId: responsibleId || '',
            customValues: {}
        },
        prefixId, // Store the prefix ID used
        economicData: {
            lines: [],
            subtotalAmount: 0,
            vatAmount: 0,
            totalAmount: 0
        },
        communications: [],
        status: 'Pendiente Documentación',
        attachments: [],
        tasks: [],
        movimientos: initialMovements,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        situation: 'Iniciado'
    };

    await saveOrUpdateCase(newCase);

    // Fast-path: do not block case creation/navigation while loading prefix movements.
    if (prefixId && shouldDeferMovements) {
        void (async () => {
            try {
                const predefined = await getPrefijoMovimientos(prefixId);
                const deferredMovements = await Promise.all(predefined.map(async (p, idx) => {
                    let finalImporte = p.importePorDefecto || 0;

                    if (!finalImporte) {
                        try {
                            const masterMov = await getMovimientoById(prefixId, p.movimientoId);
                            if (masterMov && masterMov.importePorDefecto) {
                                finalImporte = masterMov.importePorDefecto;
                            }
                        } catch (err) {
                            console.warn('Deferred init: error fetching master movement fallback amount:', p.movimientoId);
                        }
                    }

                    return {
                        id: `mov_${Date.now()}_${idx}`,
                        expedienteId: fileNumber,
                        movimientoId: p.movimientoId,
                        orden: p.orden,
                        nombreSnapshot: p.nombre || '',
                        codigoSnapshot: (p as any).codigo || '',
                        naturalezaSnapshot: (p as any).naturaleza || Naturaleza.OTRO,
                        descripcionOverride: p.nombre || '',
                        importe: roundToTwo(finalImporte),
                        regimenIva: (p as any).regimenIva || RegimenIVA.SUJETO,
                        ivaPorcentaje: (p as any).ivaPorcentaje || 21,
                        estado: EstadoMovimiento.REALIZADO,
                        facturable: p.categoria === 'OPERATIVO',
                        fecha: new Date().toISOString(),
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    } as MovimientoExpediente;
                }));

                const caseDocRef = doc(db, 'cases', fileNumber);
                await updateDoc(caseDocRef, {
                    movimientos: deferredMovements,
                    updatedAt: new Date().toISOString()
                });
            } catch (error) {
                console.warn(`Deferred movement initialization failed for case ${fileNumber}:`, error);
            }
        })();
    }

    return newCase;
};

/**
 * Emergency utility to repair/initialize movements for an existing case.
 * Useful if any case was created without mandatory movements during rollout.
 */
export const repairCaseMovements = async (
    fileNumber: string,
    prefixId: string
): Promise<{ success: boolean; repairedCount: number }> => {
    try {
        const cases = await getCaseHistory();
        const caseRecord = cases.find(c => c.fileNumber === fileNumber);

        if (!caseRecord) {
            throw new Error(`Expediente ${fileNumber} no encontrado`);
        }

        const currentMovements = caseRecord.movimientos || [];
        const predefined = await getPrefijoMovimientos(prefixId);
        const missingMovements: MovimientoExpediente[] = [];

        predefined.forEach((p, idx) => {
            // Check if this specific movement type already exists
            const exists = currentMovements.some(m => m.movimientoId === p.movimientoId);
            if (!exists) {
                missingMovements.push({
                    id: `mov_repair_${Date.now()}_${idx}`,
                    expedienteId: fileNumber,
                    movimientoId: p.movimientoId,
                    orden: p.orden,
                    nombreSnapshot: p.nombre || '',
                    codigoSnapshot: (p as any).codigo || '',
                    naturalezaSnapshot: (p as any).naturaleza || Naturaleza.OTRO,
                    descripcionOverride: p.nombre || '',
                    importe: roundToTwo(p.importePorDefecto || 0),
                    regimenIva: (p as any).regimenIva || RegimenIVA.SUJETO,
                    ivaPorcentaje: (p as any).ivaPorcentaje || 21,
                    estado: p.estadoInicial,
                    facturable: p.categoria === 'OPERATIVO',
                    fecha: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }
        });

        if (missingMovements.length > 0) {
            const updatedMovements = [...currentMovements, ...missingMovements].sort((a, b) => a.orden - b.orden);
            const caseDocRef = doc(caseCollection, fileNumber);
            await updateDoc(caseDocRef, {
                movimientos: updatedMovements,
                updatedAt: new Date().toISOString()
            });
            return { success: true, repairedCount: missingMovements.length };
        }

        return { success: true, repairedCount: 0 };
    } catch (error) {
        console.error('Error repairing case movements:', error);
        throw error;
    }
};

export const getSavedClients = async (): Promise<Client[]> => {
    const snapshot = await getDocs(clientCollection);
    return snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as Client));
};

export const saveOrUpdateClient = async (client: Client): Promise<Client[]> => {
    const { id, ...clientData } = client;
    if (!id) {
        throw new Error("Client must have an ID to be saved or updated.");
    }
    const clientDocRef = doc(db, 'clients', id);
    await setDoc(clientDocRef, clientData);
    return getSavedClients();
};

export const deleteClient = async (clientId: string): Promise<Client[]> => {
    const clientDocRef = doc(db, 'clients', clientId);
    await deleteDoc(clientDocRef);
    return getSavedClients();
};

export const getSavedVehicles = async (): Promise<Vehicle[]> => {
    const snapshot = await getDocs(vehicleCollection);
    return snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) } as Vehicle));
};

export const saveOrUpdateVehicle = async (vehicle: Vehicle): Promise<Vehicle[]> => {
    const { id, ...vehicleData } = vehicle;
    if (!id) throw new Error("Vehicle must have an ID to be saved or updated.");

    const vehicleDocRef = doc(db, 'vehicles', id);
    await setDoc(vehicleDocRef, vehicleData, { merge: true });
    return getSavedVehicles();
};

export const getSettings = async (): Promise<AppSettings> => {
    const docSnap = await getDoc(settingsDoc);

    // Configuración por defecto robusta
    const defaultFieldConfigs = {
        'GE-MAT': [
            { id: 'jefatura', label: 'Jefatura Provincial', options: ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Almería'] },
            { id: 'etiqueta', label: 'Distintivo Ambiental', options: ['0 Emisiones', 'ECO', 'C', 'B', 'Sin Distintivo'] }
        ],
        'FI-TRI': [
            { id: 'modelo', label: 'Modelo', options: ['303', '111', '115', '390', '190'] },
            { id: 'trimestre', label: 'Periodo', options: ['1T', '2T', '3T', '4T', 'Anual'] }
        ],
        'FI-CONTA': [
            { id: 'tipo_libro', label: 'Tipo de Libro', options: ['Diario', 'Inventario y Cuentas', 'Actas', 'Socios'] }
        ]
    };

    const defaultFileTypes = {
        'GE-MAT': ['Matriculación', 'Transferencia', 'Baja', 'Duplicado', 'Informe', 'Importación'],
        'FI-TRI': ['Presentación Trimestral', 'Declaración Renta', 'Impuesto Sociedades', 'Recurso'],
        'FI-CONTA': ['Contabilidad Mensual', 'Cierre Anual', 'Legalización Libros']
    };

    const defaultAgency = {
        name: 'Gestoría Administrativa Modelo',
        cif: '',
        address: '',
        managerName: '',
        managerColegiado: '',
        managerDni: ''
    };

    const defaultSettings: AppSettings = {
        fileCounter: 1,
        generalSavePath: 'C:\\GESTORIA\\EXPEDIENTES\\',
        mandatoBody: DEFAULT_MANDATO_BODY,
        agency: defaultAgency,
        fieldConfigs: defaultFieldConfigs,
        caseStatuses: DEFAULT_CASE_STATUSES,
        fileTypes: defaultFileTypes,
        deletePassword: '1812',
        defaultInitialStatus: 'En Tramitación'
    };

    if (docSnap.exists()) {
        const data = docSnap.data() as any;
        // Fusionar con defaults para asegurar que existan las nuevas propiedades
        const settings: AppSettings = {
            ...defaultSettings,
            ...data,
            agency: data.agency || defaultAgency,
            fieldConfigs: data.fieldConfigs || defaultFieldConfigs,
            caseStatuses: data.caseStatuses || DEFAULT_CASE_STATUSES,
            fileTypes: data.fileTypes || defaultFileTypes
        };

        // Si faltan campos clave en la DB, guardarlos
        if (!data.agency || !data.caseStatuses || !data.fileTypes) {
            await setDoc(settingsDoc, settings, { merge: true });
        }

        return settings;
    }

    // Crear configuración inicial si no existe
    await setDoc(settingsDoc, defaultSettings);
    return defaultSettings;
};

export const saveSettings = async (settings: Partial<AppSettings>): Promise<void> => {
    await setDoc(settingsDoc, settings, { merge: true });
};

export const getEconomicTemplates = async (): Promise<EconomicTemplates> => {
    const docSnap = await getDoc(templatesDoc);
    if (docSnap.exists()) {
        const data = docSnap.data() as any;
        if (data && data.templates) {
            return data.templates as EconomicTemplates;
        }
    }
    await setDoc(templatesDoc, { templates: INITIAL_ECONOMIC_TEMPLATES });
    return INITIAL_ECONOMIC_TEMPLATES;
};


export const saveEconomicTemplates = async (templates: EconomicTemplates): Promise<void> => {
    await setDoc(templatesDoc, { templates });
};

// --- USERS ---
export const getUsers = async (): Promise<any[]> => {
    const snapshot = await getDocs(usersCollection);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const saveUser = async (user: any): Promise<any[]> => {
    const { id, ...userData } = user;
    const userDocRef = id ? doc(usersCollection, id) : doc(usersCollection);
    await setDoc(userDocRef, userData, { merge: true });
    return getUsers();
};
