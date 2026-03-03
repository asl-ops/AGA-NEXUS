import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    writeBatch
} from 'firebase/firestore';
import { db } from './firebase';
import { PrefijoMovimiento } from '../types';
import { assertConfigDestructiveAllowed } from '@/config/configProtection';

const COLLECTION_NAME = 'prefijoMovimientos';

const getMovimientoOrder = (movimiento: Partial<PrefijoMovimiento> & { order?: number }): number => {
    const rawOrden = Number(movimiento.orden);
    if (Number.isFinite(rawOrden) && rawOrden > 0) return rawOrden;
    const rawOrder = Number(movimiento.order);
    if (Number.isFinite(rawOrder) && rawOrder > 0) return rawOrder;
    return 0;
};

const hasSequentialOrder = (movimientos: PrefijoMovimiento[]): boolean => {
    const sorted = [...movimientos].sort((a, b) => getMovimientoOrder(a) - getMovimientoOrder(b));
    return sorted.every((movimiento, index) => getMovimientoOrder(movimiento) === index + 1);
};

async function normalizePrefijoMovimientosOrder(prefijoId: string): Promise<void> {
    if (!prefijoId) return;

    const q = query(
        collection(db, COLLECTION_NAME),
        where('prefijoId', '==', prefijoId)
    );
    const querySnapshot = await getDocs(q);
    const movimientos = querySnapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
    } as PrefijoMovimiento));

    if (!movimientos.length || hasSequentialOrder(movimientos)) return;

    const sorted = [...movimientos].sort((a, b) => getMovimientoOrder(a) - getMovimientoOrder(b));
    const batch = writeBatch(db);

    sorted.forEach((movimiento, index) => {
        const nextOrder = index + 1;
        if (getMovimientoOrder(movimiento) !== nextOrder) {
            batch.update(doc(db, COLLECTION_NAME, movimiento.id), {
                orden: nextOrder,
                order: nextOrder
            });
        }
    });

    await batch.commit();
}

/**
 * Edit permissions for a PrefijoMovimiento
 */
export interface EditPermissions {
    canDelete: boolean;
    canEditMovimiento: boolean;
    canEditOrden: boolean;
    canEditImporte: boolean;
    canEditObligatorio: boolean;
    canEditEstado: boolean;
}

/**
 * Check if a PrefijoMovimiento can be deleted
 */
export function canDeleteMovimiento(movimiento: PrefijoMovimiento): boolean {
    // CABECERA movements that are bloqueado cannot be deleted
    if (movimiento.categoria === 'CABECERA' && movimiento.bloqueado) {
        return false;
    }
    return true;
}

/**
 * Get edit permissions for a PrefijoMovimiento
 */
export function canEditMovimiento(movimiento: PrefijoMovimiento): EditPermissions {
    const isCabeceraBlocked = movimiento.categoria === 'CABECERA' && movimiento.bloqueado;

    return {
        canDelete: !isCabeceraBlocked,
        canEditMovimiento: !isCabeceraBlocked,  // Cannot change the movimientoId
        canEditOrden: true,                      // Can always reorder
        canEditImporte: true,                    // Can always edit default amount
        canEditObligatorio: !isCabeceraBlocked,
        canEditEstado: !isCabeceraBlocked
    };
}

/**
 * Get all PrefijoMovimientos for a specific prefix
 */
export async function getPrefijoMovimientos(prefijoId: string): Promise<PrefijoMovimiento[]> {
    console.log('🔍 getPrefijoMovimientos called with prefijoId:', prefijoId, 'collection:', COLLECTION_NAME);

    // Validation: Prevent Firestore query with undefined
    if (!prefijoId) {
        console.warn('⚠️ getPrefijoMovimientos called with undefined prefijoId. Returning empty array.');
        return [];
    }

    try {
        const q = query(
            collection(db, COLLECTION_NAME),
            where('prefijoId', '==', prefijoId)
        );
        const querySnapshot = await getDocs(q);
        const movements = querySnapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
        } as PrefijoMovimiento));

        if (!hasSequentialOrder(movements)) {
            await normalizePrefijoMovimientosOrder(prefijoId);
            return getPrefijoMovimientos(prefijoId);
        }

        console.log('✅ Successfully loaded', movements.length, 'movements for prefix:', prefijoId);
        // Sort in memory to avoid needing a composite index in Firestore
        return movements.sort((a, b) => getMovimientoOrder(a) - getMovimientoOrder(b));
    } catch (error: any) {
        console.error("🔥 Error getting prefijo movimientos (raw):", error);
        console.error("🔥 error?.code:", error?.code);
        console.error("🔥 error?.message:", error?.message);
        console.error("🔥 error?.stack:", error?.stack);
        console.error("🔥 String(error):", String(error));
        console.error("🔥 JSON:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
        throw error;
    }
}

/**
 * Get PrefijoMovimientos separated by categoria
 */
export async function getPrefijoMovimientosByCategorias(prefijoId: string): Promise<{
    cabecera: PrefijoMovimiento[];
    operativo: PrefijoMovimiento[];
}> {
    try {
        const all = await getPrefijoMovimientos(prefijoId);
        return {
            cabecera: all.filter(m => m.categoria === 'CABECERA'),
            operativo: all.filter(m => m.categoria === 'OPERATIVO')
        };
    } catch (error) {
        console.error('Error getting prefijo movimientos by categorias:', error);
        throw error;
    }
}

/**
 * Get a single PrefijoMovimiento by ID
 */
export async function getPrefijoMovimientoById(id: string): Promise<PrefijoMovimiento | null> {
    try {
        const docRef = doc(db, COLLECTION_NAME, id);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return {
                id: docSnap.id,
                ...docSnap.data()
            } as PrefijoMovimiento;
        }
        return null;
    } catch (error) {
        console.error('Error getting prefijo movimiento:', error);
        throw error;
    }
}

/**
 * Add a new PrefijoMovimiento
 */
export async function addPrefijoMovimiento(
    data: Omit<PrefijoMovimiento, 'id'>
): Promise<PrefijoMovimiento> {
    // Validation: Prevent Firestore operation with undefined prefijoId
    if (!data.prefijoId) {
        const error = new Error('Cannot add PrefijoMovimiento: prefijoId is undefined');
        console.error('❌ addPrefijoMovimiento called with undefined prefijoId');
        throw error;
    }

    try {
        await normalizePrefijoMovimientosOrder(data.prefijoId);
        const existing = await getPrefijoMovimientos(data.prefijoId);
        const nextOrder = existing.length + 1;

        const movimientoData = {
            ...data,
            orden: nextOrder,
            order: nextOrder
        };

        const docRef = await addDoc(collection(db, COLLECTION_NAME), movimientoData);

        return {
            id: docRef.id,
            ...movimientoData
        };
    } catch (error) {
        console.error('Error adding prefijo movimiento:', error);
        throw error;
    }
}

/**
 * Update an existing PrefijoMovimiento
 */
export async function updatePrefijoMovimiento(
    id: string,
    data: Partial<Omit<PrefijoMovimiento, 'id'>>
): Promise<void> {
    try {
        // Get current data to check permissions
        const current = await getPrefijoMovimientoById(id);
        if (!current) {
            throw new Error(`PrefijoMovimiento con ID "${id}" no encontrado`);
        }

        // Check permissions
        const permissions = canEditMovimiento(current);

        // Validate edits against permissions
        if (data.movimientoId && !permissions.canEditMovimiento) {
            throw new Error('No se puede cambiar el movimiento de un movimiento de cabecera bloqueado');
        }
        if (data.obligatorio !== undefined && !permissions.canEditObligatorio) {
            throw new Error('No se puede cambiar el campo obligatorio de un movimiento de cabecera bloqueado');
        }
        if (data.estadoInicial && !permissions.canEditEstado) {
            throw new Error('No se puede cambiar el estado inicial de un movimiento de cabecera bloqueado');
        }

        const docRef = doc(db, COLLECTION_NAME, id);
        await updateDoc(docRef, data);
    } catch (error) {
        console.error('Error updating prefijo movimiento:', error);
        throw error;
    }
}

/**
 * Delete a PrefijoMovimiento
 */
export async function deletePrefijoMovimiento(
    id: string,
    options?: { bypassToken?: string }
): Promise<void> {
    try {
        assertConfigDestructiveAllowed(`movimiento predefinido ${id}`, options);
        // Get current data to check if deletion is allowed
        const current = await getPrefijoMovimientoById(id);
        if (!current) {
            throw new Error(`PrefijoMovimiento con ID "${id}" no encontrado`);
        }

        if (!canDeleteMovimiento(current)) {
            throw new Error('No se puede eliminar un movimiento de cabecera bloqueado');
        }

        const docRef = doc(db, COLLECTION_NAME, id);
        await deleteDoc(docRef);
        await normalizePrefijoMovimientosOrder(current.prefijoId);
    } catch (error) {
        console.error('Error deleting prefijo movimiento:', error);
        throw error;
    }
}

/**
 * Reorder PrefijoMovimientos for a prefix
 * Updates the orden field for multiple movimientos in a batch
 * Validates that CABECERA movements stay before OPERATIVO movements
 */
export async function reorderPrefijoMovimientos(
    prefijoId: string,
    newOrder: string[]  // Array of PrefijoMovimiento IDs in desired order
): Promise<void> {
    try {
        // Get all movimientos to validate ordering
        const allMovimientos = await getPrefijoMovimientos(prefijoId);
        const movimientosMap = new Map(allMovimientos.map(m => [m.id, m]));

        if (allMovimientos.length !== newOrder.length) {
            throw new Error('El nuevo orden no incluye todos los movimientos del prefijo.');
        }

        const allIds = new Set(allMovimientos.map(m => m.id));
        const seen = new Set<string>();
        for (const id of newOrder) {
            if (!allIds.has(id)) {
                throw new Error('Se detectó un movimiento inválido en el nuevo orden.');
            }
            if (seen.has(id)) {
                throw new Error('No se permiten movimientos duplicados en el orden.');
            }
            seen.add(id);
        }

        // Validate that CABECERA movements come before OPERATIVO
        let lastCabeceraIndex = -1;
        let firstOperativoIndex = -1;

        newOrder.forEach((id, index) => {
            const movimiento = movimientosMap.get(id);
            if (movimiento) {
                if (movimiento.categoria === 'CABECERA') {
                    lastCabeceraIndex = index;
                } else if (movimiento.categoria === 'OPERATIVO' && firstOperativoIndex === -1) {
                    firstOperativoIndex = index;
                }
            }
        });

        // If we have both types, CABECERA must come before OPERATIVO
        if (lastCabeceraIndex !== -1 && firstOperativoIndex !== -1 && lastCabeceraIndex > firstOperativoIndex) {
            throw new Error(
                'Los movimientos de sistema (CABECERA) deben estar antes que los movimientos operativos. ' +
                'Por favor, mantenga los movimientos del sistema al principio de la lista.'
            );
        }

        const batch = writeBatch(db);

        newOrder.forEach((id, index) => {
            const docRef = doc(db, COLLECTION_NAME, id);
            batch.update(docRef, { orden: index + 1, order: index + 1 });
        });

        await batch.commit();
    } catch (error) {
        console.error('Error reordering prefijo movimientos:', error);
        throw error;
    }
}

/**
 * Bulk create PrefijoMovimientos (useful for migration/import)
 */
export async function bulkCreatePrefijoMovimientos(
    movimientos: Array<Omit<PrefijoMovimiento, 'id'>>
): Promise<void> {
    try {
        const batch = writeBatch(db);

        movimientos.forEach(movimiento => {
            const docRef = doc(collection(db, COLLECTION_NAME));
            batch.set(docRef, movimiento);
        });

        await batch.commit();
    } catch (error) {
        console.error('Error bulk creating prefijo movimientos:', error);
        throw error;
    }
}
