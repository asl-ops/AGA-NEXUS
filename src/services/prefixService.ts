import { db } from '../services/firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, query, where } from 'firebase/firestore';
import { PrefixConfig } from '../types';
import { assertConfigDestructiveAllowed } from '@/config/configProtection';

const prefixesCollection = collection(db, 'prefixes');

// Fetch active prefixes (legacy-compatible: missing isActive => active)
export const getActivePrefixes = async (): Promise<PrefixConfig[]> => {
    try {
        const snapshot = await getDocs(prefixesCollection);
        const data: PrefixConfig[] = snapshot.docs
            .map(doc => ({ ...doc.data(), id: doc.id } as PrefixConfig))
            .filter(prefix => prefix.isActive !== false);
        return data.sort((a, b) => a.code.localeCompare(b.code));
    } catch (error) {
        console.error('Error fetching active prefixes:', error);
        return [];
    }
};

// Fetch all prefixes including inactive ones (for Administration)
export const getAllPrefixes = async (): Promise<PrefixConfig[]> => {
    try {
        const snapshot = await getDocs(prefixesCollection);
        const data: PrefixConfig[] = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as PrefixConfig));
        return data.sort((a, b) => a.code.localeCompare(b.code));
    } catch (error) {
        console.error('Error fetching all prefixes:', error);
        return [];
    }
};

// COMPATIBILITY ALIAS: Default getPrefixes returns active ones
export const getPrefixes = getActivePrefixes;

// Fetch a prefix by its code
export const getPrefixByCode = async (code: string): Promise<PrefixConfig | null> => {
    try {
        const snapshot = await getDocs(prefixesCollection);
        for (const docSnapshot of snapshot.docs) {
            const pref = { ...docSnapshot.data(), id: docSnapshot.id } as PrefixConfig;
            if (pref.code === code) {
                return pref;
            }
        }
        return null;
    } catch (error) {
        console.error('Error fetching prefix by code:', error);
        return null;
    }
};

/**
 * Gets the next available number for a prefix atomically.
 * Increments the ultimoNumeroAsignado in the prefix document.
 */
import { runTransaction } from 'firebase/firestore';

export const getPrefixNextNumber = async (prefixId: string): Promise<{ nextNumber: number, formattedNumber: string }> => {
    try {
        const prefixDocRef = doc(prefixesCollection, prefixId);

        const result = await runTransaction(db, async (transaction) => {
            const prefixDoc = await transaction.get(prefixDocRef);
            if (!prefixDoc.exists()) {
                throw new Error("Prefix does not exist");
            }

            const data = prefixDoc.data() as any;
            const currentNum = data.ultimoNumeroAsignado || 0;
            const nextNum = currentNum + 1;
            const length = data.numberLength || 4;

            transaction.update(prefixDocRef, { ultimoNumeroAsignado: nextNum });

            return {
                nextNumber: nextNum,
                formattedNumber: String(nextNum).padStart(length, '0')
            };
        });

        return result;
    } catch (error) {
        console.error('Error getting next prefix number:', error);
        throw error;
    }
};

// Create a new prefix
export const createPrefix = async (prefix: PrefixConfig): Promise<void> => {
    try {
        const prefixDoc = doc(prefixesCollection, prefix.id);
        await setDoc(prefixDoc, prefix);
    } catch (error) {
        console.error('Error creating prefix:', error);
        throw error;
    }
};

// Save/update an existing prefix
export const savePrefix = async (prefix: PrefixConfig): Promise<void> => {
    try {
        const prefixDoc = doc(prefixesCollection, prefix.id);
        await setDoc(prefixDoc, prefix, { merge: true });
    } catch (error) {
        console.error('Error saving prefix:', error);
        throw error;
    }
};


/**
 * Bulk import prefixes (Idempotent)
 * Used for initial data migration from JSON/Excel
 */
export const bulkImportPrefixes = async (prefixes: any[]): Promise<void> => {
    const now = new Date().toISOString();
    for (const data of prefixes) {
        const id = `prefix_${data.prefijo}`;
        const prefixObj: PrefixConfig = {
            id,
            code: data.prefijo,
            description: data.descripcion,
            isActive: true,
            lines: [],
            ultimoNumeroAsignado: data.contador,
            numberLength: 4,
            createdAt: now,
            updatedAt: now
        };
        await savePrefix(prefixObj);
    }
};

// Delete a prefix (Logical deletion if used, Physical if fresh)
export const deletePrefix = async (
    prefixId: string,
    options?: { bypassToken?: string }
): Promise<void> => {
    try {
        assertConfigDestructiveAllowed(`prefijo ${prefixId}`, options);
        const prefixDocRef = doc(prefixesCollection, prefixId);

        // Safety check: Is this prefix used in any cases?
        const casesCollection = collection(db, 'cases');
        const q = query(casesCollection, where('prefixId', '==', prefixId));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            // LOGICAL DELETION (Baja): We must preserve the document for historical coherence
            await setDoc(prefixDocRef, { isActive: false, updatedAt: new Date().toISOString() }, { merge: true });
        } else {
            // PHYSICAL DELETION: Safe to remove as it was never used
            await deleteDoc(prefixDocRef);
        }
    } catch (error: any) {
        console.error('Error in prefix deletion/deactivation:', error);
        throw error;
    }
};

/**
 * Explicitly deactivates or reactivates a prefix
 */
export const updatePrefixStatus = async (prefixId: string, active: boolean): Promise<void> => {
    try {
        if (!active) {
            assertConfigDestructiveAllowed(`desactivación de prefijo ${prefixId}`);
        }
        const prefixDocRef = doc(prefixesCollection, prefixId);
        await setDoc(prefixDocRef, { isActive: active, updatedAt: new Date().toISOString() }, { merge: true });
    } catch (error) {
        console.error('Error updating prefix status:', error);
        throw error;
    }
};
