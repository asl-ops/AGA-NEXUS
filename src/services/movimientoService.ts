import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    setDoc,
    updateDoc,
    query,
    where,
    Timestamp
} from 'firebase/firestore';
import { db } from './firebase';
import { Movimiento, MovimientoCuentaContable, Naturaleza, RegimenIVA, RolCuenta, ModoImporte } from '../types';
import { assertConfigDestructiveAllowed } from '@/config/configProtection';

const ROOT_COLLECTION = 'prefixes';
const SUB_COLLECTION = 'movements';

function getCollectionRef(prefixId: string) {
    return collection(db, ROOT_COLLECTION, prefixId, SUB_COLLECTION);
}

/**
 * Normalize codigo for case-insensitive uniqueness
 * Converts to uppercase and removes spaces/hyphens
 */
function normalizeCodigo(codigo: string): string {
    return codigo.toUpperCase().replace(/[\s-]/g, '');
}

function sanitizeUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(obj).filter(([, value]) => value !== undefined)
    ) as Partial<T>;
}

/**
 * Validation result for movimiento data
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Validate minimum accounting configuration by naturaleza
 */
function validateAccountingByNaturaleza(
    movimiento: Partial<Movimiento>,
    cuentas: MovimientoCuentaContable[]
): string[] {
    const errors: string[] = [];
    const roles = cuentas.map(c => c.rol);

    switch (movimiento.naturaleza) {
        case Naturaleza.HONORARIO:
            if (movimiento.regimenIva === RegimenIVA.SUJETO) {
                if (!roles.includes(RolCuenta.INGRESO)) {
                    errors.push('Los honorarios requieren una cuenta de INGRESO');
                }
                if (!roles.includes(RolCuenta.IVA_REPER)) {
                    errors.push('Los honorarios sujetos a IVA requieren una cuenta de IVA_REPER');
                }
                if (!roles.includes(RolCuenta.CLIENTE)) {
                    errors.push('Los honorarios requieren una cuenta de CLIENTE');
                }
            } else {
                if (!roles.includes(RolCuenta.INGRESO)) {
                    errors.push('Los honorarios requieren una cuenta de INGRESO');
                }
                if (!roles.includes(RolCuenta.CLIENTE)) {
                    errors.push('Los honorarios requieren una cuenta de CLIENTE');
                }
            }
            break;

        case Naturaleza.SUPLIDO:
            if (!roles.includes(RolCuenta.SUPLIDO_CUENTA_PUENTE)) {
                errors.push('Los suplidos requieren una cuenta puente (SUPLIDO_CUENTA_PUENTE)');
            }
            if (!roles.includes(RolCuenta.CLIENTE)) {
                errors.push('Los suplidos requieren una cuenta de CLIENTE');
            }
            break;

        case Naturaleza.ENTREGA_A_CUENTA:
            if (!roles.includes(RolCuenta.PROVISION_CUENTA_PUENTE)) {
                errors.push('Las entregas a cuenta requieren una cuenta puente de provisión (PROVISION_CUENTA_PUENTE)');
            }
            break;
    }

    return errors;
}

/**
 * Validate movimiento data according to business rules
 */
export function validateMovimiento(
    movimiento: Partial<Movimiento>,
    cuentas: MovimientoCuentaContable[] = []
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Rule 1: Suplidos cannot have IVA
    if (movimiento.naturaleza === Naturaleza.SUPLIDO) {
        if (movimiento.regimenIva !== RegimenIVA.NO_SUJETO) {
            errors.push('Los suplidos deben tener régimen IVA "NO_SUJETO"');
        }
        if (movimiento.ivaPorDefecto !== null && movimiento.ivaPorDefecto !== undefined) {
            errors.push('Los suplidos no pueden tener IVA por defecto');
        }
        if (movimiento.afectaIva === true) {
            errors.push('Los suplidos no pueden afectar al IVA');
        }

        // FITRI System: Subcategoría obligatoria para suplidos
        if (!movimiento.subcategoriaSuplido || movimiento.subcategoriaSuplido.trim() === '') {
            errors.push('Los suplidos requieren una subcategoría obligatoria (tipo de suplido)');
        }
    }

    // Rule 2: Entregas a cuenta don't go to invoice
    if (movimiento.naturaleza === Naturaleza.ENTREGA_A_CUENTA) {
        if (movimiento.afectaFactura === true) {
            errors.push('Las entregas a cuenta no pueden afectar a la factura');
        }
        if (movimiento.imprimibleEnFactura === true) {
            errors.push('Las entregas a cuenta no pueden ser imprimibles en factura');
        }
        if (movimiento.regimenIva !== RegimenIVA.NO_SUJETO) {
            errors.push('Las entregas a cuenta deben tener régimen IVA "NO_SUJETO"');
        }
    }

    // Rule 3: Honorarios MUST have IVA (with controlled exception)
    if (movimiento.naturaleza === Naturaleza.HONORARIO) {
        if (movimiento.regimenIva !== RegimenIVA.SUJETO) {
            if (!movimiento.permitirExcepcionIva) {
                errors.push('Los honorarios deben tener régimen IVA "SUJETO". Para casos excepcionales (exentos, UE, etc.), marque "Permitir excepción" y justifique el motivo.');
            } else {
                if (!movimiento.motivoExencion || movimiento.motivoExencion.trim() === '') {
                    errors.push('Debe especificar el motivo de la exención de IVA para este honorario');
                }
                warnings.push(`Honorario con excepción de IVA: ${movimiento.motivoExencion || 'sin justificación'}`);
            }
        }

        if (movimiento.regimenIva === RegimenIVA.SUJETO && !movimiento.ivaPorDefecto) {
            warnings.push('Los honorarios sujetos a IVA normalmente tienen IVA por defecto (21%)');
        }
    }

    // Rule 4: Required fields
    if (!movimiento.codigo || movimiento.codigo.trim() === '') {
        errors.push('El código es obligatorio');
    }
    if (!movimiento.nombre || movimiento.nombre.trim() === '') {
        errors.push('El nombre es obligatorio');
    }
    if (!movimiento.naturaleza) {
        errors.push('La naturaleza es obligatoria');
    }
    if (!movimiento.regimenIva) {
        errors.push('El régimen IVA es obligatorio');
    }

    // Rule 5: Validate minimum accounting configuration
    if (cuentas.length > 0) {
        const accountingErrors = validateAccountingByNaturaleza(movimiento, cuentas);
        errors.push(...accountingErrors);
    } else if (movimiento.id) {
        warnings.push('Este movimiento no tiene cuentas contables asignadas');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Get all movimientos from Firestore
 */
export async function getMovimientos(prefixId: string): Promise<Movimiento[]> {
    try {
        const querySnapshot = await getDocs(getCollectionRef(prefixId));
        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Movimiento));
    } catch (error) {
        console.error('Error getting movimientos:', error);
        throw error;
    }
}

/**
 * Get active movimientos only
 * Legacy-compatible: missing "activo" is considered active.
 */
export async function getActiveMovimientos(prefixId: string): Promise<Movimiento[]> {
    try {
        const querySnapshot = await getDocs(getCollectionRef(prefixId));
        return querySnapshot.docs
            .map(doc => ({
                id: doc.id,
                ...doc.data()
            } as Movimiento))
            .filter(movimiento => movimiento.activo !== false);
    } catch (error) {
        console.error('Error getting active movimientos:', error);
        throw error;
    }
}

/**
 * Get movimiento by ID
 */
export async function getMovimientoById(prefixId: string, id: string): Promise<Movimiento | null> {
    try {
        const docRef = doc(db, ROOT_COLLECTION, prefixId, SUB_COLLECTION, id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return {
                id: docSnap.id,
                ...docSnap.data()
            } as Movimiento;
        }
        return null;
    } catch (error) {
        console.error('Error getting movimiento:', error);
        throw error;
    }
}

/**
 * Get movimiento by codigo (case-insensitive)
 */
export async function getMovimientoByCodigo(prefixId: string, codigo: string): Promise<Movimiento | null> {
    try {
        const normalized = normalizeCodigo(codigo);
        const allMovimientos = await getMovimientos(prefixId);

        // Find by normalized codigo
        const found = allMovimientos.find(m => normalizeCodigo(m.codigo) === normalized);
        return found || null;
    } catch (error) {
        console.error('Error getting movimiento by codigo:', error);
        throw error;
    }
}

/**
 * Create a new movimiento
 */
export async function createMovimiento(
    prefixId: string,
    data: Omit<Movimiento, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Movimiento> {
    try {
        // Validate data (without accounting for new movimientos)
        const validation = validateMovimiento(data, []);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Check for duplicate codigo (case-insensitive)
        const existing = await getMovimientoByCodigo(prefixId, data.codigo);
        if (existing) {
            throw new Error(
                `Ya existe un movimiento con el código "${existing.codigo}" ` +
                `(se detectó como duplicado de "${data.codigo}")`
            );
        }

        const now = Timestamp.now().toDate().toISOString();
        const movimientoData = {
            ...data,
            codigo: data.codigo.toUpperCase(), // Store in uppercase
            createdAt: now,
            updatedAt: now
        };

        const docRef = await addDoc(getCollectionRef(prefixId), movimientoData);

        return {
            id: docRef.id,
            ...movimientoData
        };
    } catch (error) {
        console.error('Error creating movimiento:', error);
        throw error;
    }
}

/**
 * Update an existing movimiento
 */
export async function updateMovimiento(
    prefixId: string,
    id: string,
    data: Partial<Omit<Movimiento, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
    try {
        // Get current data for validation
        const current = await getMovimientoById(prefixId, id);
        if (!current) {
            throw new Error(`Movimiento con ID "${id}" no encontrado`);
        }

        // Check if naturaleza or regimenIva is being changed
        if (data.naturaleza && data.naturaleza !== current.naturaleza) {
            // Check if movimiento is in use
            const prefijoMovimientosQuery = query(
                collection(db, 'prefijoMovimientos'),
                where('movimientoId', '==', id)
            );
            const prefijoMovimientosSnapshot = await getDocs(prefijoMovimientosQuery);

            if (!prefijoMovimientosSnapshot.empty) {
                throw new Error(
                    `No se puede cambiar la naturaleza de este movimiento porque está siendo usado en ${prefijoMovimientosSnapshot.size} prefijo(s). ` +
                    `Cambiar la naturaleza podría romper la contabilidad de expedientes existentes.`
                );
            }
        }

        if (data.regimenIva && data.regimenIva !== current.regimenIva) {
            // Check if movimiento is in use
            const prefijoMovimientosQuery = query(
                collection(db, 'prefijoMovimientos'),
                where('movimientoId', '==', id)
            );
            const prefijoMovimientosSnapshot = await getDocs(prefijoMovimientosQuery);

            if (!prefijoMovimientosSnapshot.empty) {
                throw new Error(
                    `No se puede cambiar el régimen IVA de este movimiento porque está siendo usado en ${prefijoMovimientosSnapshot.size} prefijo(s). ` +
                    `Cambiar el régimen IVA podría romper la contabilidad de expedientes existentes.`
                );
            }
        }

        // Get accounting configuration
        const cuentas = await getCuentasContables(id);

        // Merge with current data for validation
        const merged = { ...current, ...data };
        const validation = validateMovimiento(merged, cuentas);
        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Check for duplicate codigo if changing it (case-insensitive)
        if (data.codigo && normalizeCodigo(data.codigo) !== normalizeCodigo(current.codigo)) {
            const existing = await getMovimientoByCodigo(prefixId, data.codigo);
            if (existing && existing.id !== id) {
                throw new Error(
                    `Ya existe un movimiento con el código "${existing.codigo}" ` +
                    `(se detectó como duplicado de "${data.codigo}")`
                );
            }
            // Normalize codigo to uppercase
            data.codigo = data.codigo.toUpperCase();
        }

        const docRef = doc(db, ROOT_COLLECTION, prefixId, SUB_COLLECTION, id);
        const sanitizedData = sanitizeUndefined(data);
        await updateDoc(docRef, {
            ...sanitizedData,
            updatedAt: Timestamp.now().toDate().toISOString()
        });
    } catch (error) {
        console.error('Error updating movimiento:', error);
        throw error;
    }
}

/**
 * Get cuentas contables for a movimiento
 */
export async function getCuentasContables(movimientoId: string): Promise<MovimientoCuentaContable[]> {
    try {
        const q = query(
            collection(db, 'movimientoCuentasContables'),
            where('movimientoId', '==', movimientoId)
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as MovimientoCuentaContable));
    } catch (error) {
        console.error('Error getting cuentas contables:', error);
        return [];
    }
}

/**
 * Soft delete a movimiento (set activo = false)
 * Physical deletion is not allowed to maintain traceability
 */
export async function softDeleteMovimiento(
    prefixId: string,
    id: string,
    options?: { bypassToken?: string }
): Promise<void> {
    try {
        assertConfigDestructiveAllowed(`movimiento ${id} del prefijo ${prefixId}`, options);
        const prefijoMovimientosQuery = query(
            collection(db, 'prefijoMovimientos'),
            where('movimientoId', '==', id)
        );
        const prefijoMovimientosSnapshot = await getDocs(prefijoMovimientosQuery);

        if (!prefijoMovimientosSnapshot.empty) {
            const count = prefijoMovimientosSnapshot.size;
            throw new Error(
                `No se puede desactivar este movimiento porque está siendo usado en ${count} prefijo(s). ` +
                `Primero debe eliminarlo de los prefijos que lo utilizan.`
            );
        }

        const docRef = doc(db, ROOT_COLLECTION, prefixId, SUB_COLLECTION, id);
        await updateDoc(docRef, {
            activo: false,
            updatedAt: Timestamp.now().toDate().toISOString()
        });
    } catch (error) {
        console.error('Error soft deleting movimiento:', error);
        throw error;
    }
}

/**
 * Delete a movimiento
 * @deprecated Use softDeleteMovimiento instead to maintain traceability
 */
export async function deleteMovimiento(_id: string): Promise<void> {
    throw new Error(
        'Physical deletion of movimientos is not allowed. Use softDeleteMovimiento() instead to maintain traceability.'
    );
}

/**
 * Get movimientos by naturaleza
 */
export async function getMovimientosByNaturaleza(prefixId: string, naturaleza: Naturaleza): Promise<Movimiento[]> {
    try {
        const q = query(getCollectionRef(prefixId), where('naturaleza', '==', naturaleza));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Movimiento));
    } catch (error) {
        console.error('Error getting movimientos by naturaleza:', error);
        throw error;
    }
}

/**
 * MIGRATION: Move global movimientos to a specific prefix
 * This is a one-time operation to transition to prefix-scoped catalogs
 */
export async function migrateGlobalMovementsToPrefix(targetPrefixId: string): Promise<{ migrated: number, errors: string[] }> {
    const errors: string[] = [];
    let migrated = 0;
    try {
        // Read from old root collection
        const oldSnapshot = await getDocs(collection(db, 'movimientos'));
        const rootItems = oldSnapshot.docs;

        if (rootItems.length === 0) {
            return { migrated: 0, errors: [] };
        }

        const targetRef = getCollectionRef(targetPrefixId);

        for (const oldDoc of rootItems) {
            const data = oldDoc.data() as Movimiento;
            // Check if already exists in target
            const subExisting = await getMovimientoByCodigo(targetPrefixId, data.codigo);
            if (!subExisting) {
                await addDoc(targetRef, {
                    ...data,
                    prefixId: targetPrefixId,
                    updatedAt: Timestamp.now().toDate().toISOString()
                });
                migrated++;
            }
        }

        return { migrated, errors };
    } catch (error: any) {
        console.error('Migration error:', error);
        return { migrated, errors: [error.message] };
    }
}

/**
 * Recovery utility:
 * Rebuild prefix catalog from movimientoIds referenced by prefijoMovimientos.
 * Keeps document IDs to preserve historical references.
 */
export async function recoverPrefixCatalogFromPredefinedRefs(prefixId: string): Promise<{ recovered: number; missing: number }> {
    if (!prefixId) return { recovered: 0, missing: 0 };

    let recovered = 0;
    let missing = 0;

    const prefijoMovimientosSnapshot = await getDocs(
        query(collection(db, 'prefijoMovimientos'), where('prefijoId', '==', prefixId))
    );

    if (prefijoMovimientosSnapshot.empty) {
        return { recovered: 0, missing: 0 };
    }

    const referencedIds = Array.from(
        new Set(
            prefijoMovimientosSnapshot.docs
                .map((docSnap) => (docSnap.data() as { movimientoId?: string }).movimientoId)
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        )
    );

    if (referencedIds.length === 0) {
        return { recovered: 0, missing: 0 };
    }

    const prefijoMovimientosByMovimientoId = new Map<string, { nombre?: string; importePorDefecto?: number | null }>();
    for (const docSnap of prefijoMovimientosSnapshot.docs) {
        const data = docSnap.data() as { movimientoId?: string; nombre?: string; importePorDefecto?: number | null };
        if (!data.movimientoId || prefijoMovimientosByMovimientoId.has(data.movimientoId)) continue;
        prefijoMovimientosByMovimientoId.set(data.movimientoId, {
            nombre: data.nombre,
            importePorDefecto: data.importePorDefecto
        });
    }

    const inferNaturaleza = (name: string): Naturaleza => {
        const n = name.toUpperCase();
        if (n.includes('HONORARIO')) return Naturaleza.HONORARIO;
        if (n.includes('ENTREGA') || n.includes('PROVISION')) return Naturaleza.ENTREGA_A_CUENTA;
        if (n.includes('INGRESO') || n.includes('TASA') || n.includes('IMPUESTO') || n.includes('DERECHO')) {
            return Naturaleza.SUPLIDO;
        }
        return Naturaleza.HONORARIO;
    };

    const inferRegimen = (naturaleza: Naturaleza): RegimenIVA => (
        naturaleza === Naturaleza.HONORARIO ? RegimenIVA.SUJETO : RegimenIVA.NO_SUJETO
    );

    const buildFallbackMovimiento = (movimientoId: string): Partial<Movimiento> => {
        const snapshot = prefijoMovimientosByMovimientoId.get(movimientoId);
        const nombre = (snapshot?.nombre || `Movimiento ${movimientoId.slice(0, 8)}`).trim();
        const naturaleza = inferNaturaleza(nombre);
        const regimenIva = inferRegimen(naturaleza);
        const codigoBase = nombre
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 24) || 'MOV_RECUPERADO';

        return {
            codigo: `${codigoBase}_${movimientoId.slice(-4).toUpperCase()}`,
            nombre,
            naturaleza,
            regimenIva,
            ivaPorDefecto: naturaleza === Naturaleza.HONORARIO ? 21 : null,
            afectaFactura: true,
            imprimibleEnFactura: true,
            afectaBaseImponible: naturaleza === Naturaleza.HONORARIO,
            afectaIva: naturaleza === Naturaleza.HONORARIO,
            modoImporte: ModoImporte.MANUAL,
            importePorDefecto: snapshot?.importePorDefecto ?? 0,
            activo: true,
            legacyId: `RECOVERED_FROM_PREFIJO_${movimientoId}`
        };
    };

    for (const movimientoId of referencedIds) {
        const targetDocRef = doc(db, ROOT_COLLECTION, prefixId, SUB_COLLECTION, movimientoId);
        const targetDoc = await getDoc(targetDocRef);
        if (targetDoc.exists()) {
            continue;
        }

        const legacyDoc = await getDoc(doc(db, 'movimientos', movimientoId));
        const legacyData = legacyDoc.exists()
            ? (legacyDoc.data() as Partial<Movimiento>)
            : buildFallbackMovimiento(movimientoId);

        if (!legacyDoc.exists()) {
            missing++;
        }

        await setDoc(targetDocRef, {
            ...legacyData,
            prefixId,
            updatedAt: Timestamp.now().toDate().toISOString()
        });
        recovered++;
    }

    return { recovered, missing };
}
