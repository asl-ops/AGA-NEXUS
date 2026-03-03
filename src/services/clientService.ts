/**
 * Servicio de Gestión de Clientes
 * Adaptado para Firebase Firestore (no REST API)
 */

import { db } from './firebase';
import {
    collection,
    doc,
    getDocs,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    startAt,
    endAt,
    limit as limitQuery
} from 'firebase/firestore';
import type {
    Client,
    ClientCreateInput,
    ClientUpdateInput,
    ClientSearchParams,
    ClientSearchResult,
} from '@/types';
import { normalizeDocumento, normalizeText, normalizeTelefono, isMostlyNumeric } from '@/utils/normalize';

const clientsCollection = collection(db, 'clients');

/**
 * Busca clientes con filtros inteligentes
 * Soporta búsqueda por nombre, documento, teléfono, email
 * Ordenamiento: documento exacto > empieza por > contiene
 */
export async function searchClients(params: ClientSearchParams): Promise<ClientSearchResult> {
    const {
        q,
        documento,
        nombre,
        telefono,
        email,
        direccion,
        tipo,
        estado = 'ACTIVO', // Por defecto solo activos
        limit = 10,
        offset = 0
    } = params;

    try {
        // FAST PATH (critical for NewCaseWizard/Typeahead):
        // If caller is doing simple text search, query Firestore by prefix + limit
        // instead of downloading all clients and filtering in memory.
        const hasOnlyGeneralSearch = !!(q && q.trim()) && !documento && !nombre && !telefono && !email && !direccion;
        if (hasOnlyGeneralSearch) {
            const rawQ = q!.trim();
            const normalizedQ = normalizeText(rawQ);
            const normalizedDocQ = normalizeDocumento(rawQ) || normalizedQ;
            const isNumericSearch = isMostlyNumeric(rawQ);
            const requestedLimit = Math.max(5, Math.min(limit === 'all' ? 50 : limit, 50));

            const candidatesMap = new Map<string, Client>();

            // Prefix search by document
            const byDocumentoSnap = await getDocs(
                query(
                    clientsCollection,
                    orderBy('documento'),
                    startAt(normalizedDocQ),
                    endAt(`${normalizedDocQ}\uf8ff`),
                    limitQuery(requestedLimit)
                )
            );
            byDocumentoSnap.docs.forEach((d) => {
                candidatesMap.set(d.id, { id: d.id, ...d.data() } as Client);
            });

            // Prefix search by name (for non-numeric lookups)
            if (!isNumericSearch) {
                const byNombreSnap = await getDocs(
                    query(
                        clientsCollection,
                        orderBy('nombre'),
                        startAt(normalizedQ),
                        endAt(`${normalizedQ}\uf8ff`),
                        limitQuery(requestedLimit)
                    )
                );
                byNombreSnap.docs.forEach((d) => {
                    candidatesMap.set(d.id, { id: d.id, ...d.data() } as Client);
                });
            }

            let filtered = Array.from(candidatesMap.values());

            if (estado) {
                filtered = filtered.filter(c => (c.estado || 'ACTIVO') === estado);
            }
            if (tipo) {
                filtered = filtered.filter(c => c.tipo === tipo);
            }

            filtered = filtered.filter(client => {
                const normalizedNombre = normalizeText(client.nombre || '');
                const normalizedDocumento = normalizeDocumento(client.documento || client.nif || '');
                const normalizedTelefono = normalizeTelefono(client.telefono || '');
                const normalizedEmail = (client.email || '').toLowerCase();
                const normalizedDireccion = normalizeText(client.domicilioFiscal?.direccion || '');
                const normalizedPoblacion = normalizeText(client.domicilioFiscal?.poblacion || '');
                const normalizedProvincia = normalizeText(client.domicilioFiscal?.provincia || '');
                const normalizedCP = (client.domicilioFiscal?.cp || '').toLowerCase();

                if (isNumericSearch) {
                    return normalizedDocumento?.includes(normalizedDocQ) ||
                        normalizedTelefono?.includes(normalizedDocQ) ||
                        normalizedCP.includes(normalizedDocQ);
                }

                return normalizedNombre.includes(normalizedQ) ||
                    normalizedDocumento?.includes(normalizedDocQ) ||
                    normalizedTelefono?.includes(normalizedDocQ) ||
                    normalizedEmail.includes(rawQ.toLowerCase()) ||
                    normalizedDireccion.includes(normalizedQ) ||
                    normalizedPoblacion.includes(normalizedQ) ||
                    normalizedProvincia.includes(normalizedQ) ||
                    normalizedCP.includes(normalizedQ);
            });

            filtered.sort((a, b) => {
                const aNombre = normalizeText(a.nombre || '');
                const bNombre = normalizeText(b.nombre || '');
                const aDoc = normalizeDocumento(a.documento || a.nif || '') || '';
                const bDoc = normalizeDocumento(b.documento || b.nif || '') || '';

                if (aDoc === normalizedDocQ) return -1;
                if (bDoc === normalizedDocQ) return 1;

                const aStartsWith = aNombre.startsWith(normalizedQ);
                const bStartsWith = bNombre.startsWith(normalizedQ);
                if (aStartsWith && !bStartsWith) return -1;
                if (!aStartsWith && bStartsWith) return 1;

                const aDocStarts = aDoc.startsWith(normalizedDocQ);
                const bDocStarts = bDoc.startsWith(normalizedDocQ);
                if (aDocStarts && !bDocStarts) return -1;
                if (!aDocStarts && bDocStarts) return 1;

                return aNombre.localeCompare(bNombre);
            });

            const total = filtered.length;
            const effectiveLimit = limit === 'all' ? total : limit;
            const paginatedItems = filtered.slice(offset, offset + effectiveLimit);
            return { items: paginatedItems, total };
        }

        // Obtener todos los clientes (Firestore no tiene búsqueda "contains" nativa eficiente)
        let clientsQuery = query(clientsCollection);

        // Filtro por estado si está especificado
        if (estado) {
            clientsQuery = query(clientsCollection, where('estado', '==', estado));
        }

        const snapshot = await getDocs(clientsQuery);
        let allClients = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Client));

        // Filtrar en memoria
        let filtered = allClients;

        // Filtro por tipo
        if (tipo) {
            filtered = filtered.filter(c => c.tipo === tipo);
        }

        // Búsqueda general (q)
        if (q && q.trim()) {
            const normalizedQ = normalizeText(q.trim());
            const isNumericSearch = isMostlyNumeric(q);

            filtered = filtered.filter(client => {
                const normalizedNombre = normalizeText(client.nombre || '');
                const normalizedDocumento = normalizeDocumento(client.documento || '');
                const normalizedTelefono = normalizeTelefono(client.telefono || '');
                const normalizedEmail = (client.email || '').toLowerCase();

                // Normalizar campos de domicilio fiscal
                const normalizedDireccion = normalizeText(client.domicilioFiscal?.direccion || '');
                const normalizedPoblacion = normalizeText(client.domicilioFiscal?.poblacion || '');
                const normalizedProvincia = normalizeText(client.domicilioFiscal?.provincia || '');
                const normalizedCP = (client.domicilioFiscal?.cp || '').toLowerCase();

                // Si es búsqueda numérica, priorizar documento y teléfono
                if (isNumericSearch) {
                    return normalizedDocumento?.includes(normalizedQ) ||
                        normalizedTelefono?.includes(normalizedQ) ||
                        normalizedCP.includes(normalizedQ);
                }

                // Búsqueda textual completa
                return normalizedNombre.includes(normalizedQ) ||
                    normalizedDocumento?.includes(normalizedQ) ||
                    normalizedTelefono?.includes(normalizedQ) ||
                    normalizedEmail.includes(q.toLowerCase()) ||
                    normalizedDireccion.includes(normalizedQ) ||
                    normalizedPoblacion.includes(normalizedQ) ||
                    normalizedProvincia.includes(normalizedQ) ||
                    normalizedCP.includes(normalizedQ);
            });

            // Ordenar resultados por relevancia
            filtered.sort((a, b) => {
                const aNombre = normalizeText(a.nombre || '');
                const bNombre = normalizeText(b.nombre || '');
                const aDoc = normalizeDocumento(a.documento || '') || '';
                const bDoc = normalizeDocumento(b.documento || '') || '';

                // Prioridad 1: Documento exacto
                if (aDoc === normalizedQ) return -1;
                if (bDoc === normalizedQ) return 1;

                // Prioridad 2: Nombre empieza por
                const aStartsWith = aNombre.startsWith(normalizedQ);
                const bStartsWith = bNombre.startsWith(normalizedQ);
                if (aStartsWith && !bStartsWith) return -1;
                if (!aStartsWith && bStartsWith) return 1;

                // Prioridad 3: Documento empieza por
                const aDocStarts = aDoc.startsWith(normalizedQ);
                const bDocStarts = bDoc.startsWith(normalizedQ);
                if (aDocStarts && !bDocStarts) return -1;
                if (!aDocStarts && bDocStarts) return 1;

                // Por defecto: orden alfabético
                return aNombre.localeCompare(bNombre);
            });
        }

        // Filtros específicos
        if (documento) {
            const normDoc = normalizeDocumento(documento);
            filtered = filtered.filter(c =>
                normalizeDocumento(c.documento || '')?.includes(normDoc || '')
            );
        }

        if (nombre) {
            const normNombre = normalizeText(nombre);
            filtered = filtered.filter(c =>
                normalizeText(c.nombre).includes(normNombre)
            );
        }

        if (telefono) {
            const normTel = normalizeTelefono(telefono);
            filtered = filtered.filter(c =>
                normalizeTelefono(c.telefono || '')?.includes(normTel || '')
            );
        }

        if (email) {
            filtered = filtered.filter(c =>
                c.email?.toLowerCase().includes(email.toLowerCase())
            );
        }

        if (direccion) {
            filtered = filtered.filter(c =>
                c.direccion?.toLowerCase().includes(direccion.toLowerCase())
            );
        }

        // Paginación
        const total = filtered.length;
        const effectiveLimit = limit === 'all' ? total : limit;
        const paginatedItems = filtered.slice(offset, offset + effectiveLimit);

        return {
            items: paginatedItems,
            total
        };
    } catch (error) {
        console.error('Error searching clients:', error);
        throw new Error('Error al buscar clientes');
    }
}

/**
 * Obtiene un cliente por ID
 */
export async function getClientById(id: string): Promise<Client> {
    try {
        const clientDoc = doc(clientsCollection, id);
        const snapshot = await getDoc(clientDoc);

        if (!snapshot.exists()) {
            throw new Error(`Cliente con ID ${id} no encontrado`);
        }

        return {
            id: snapshot.id,
            ...snapshot.data()
        } as Client;
    } catch (error) {
        console.error('Error getting client by ID:', error);
        throw error;
    }
}

/**
 * Crea un nuevo cliente
 */
export async function createClient(input: ClientCreateInput): Promise<Client> {
    try {
        const normalizedDoc = normalizeDocumento(input.documento);
        if (normalizedDoc) {
            // Verificar duplicidad exacta por documento
            const dupes = await searchClients({ documento: normalizedDoc, limit: 1 });
            const exactDupe = dupes.items.find(d => normalizeDocumento(d.documento) === normalizedDoc);

            if (exactDupe) {
                throw new Error(`Ya existe un cliente con el identificador ${normalizedDoc} (${exactDupe.nombre})`);
            }
        }

        const now = new Date().toISOString();
        const id = crypto.randomUUID();

        // Construir objeto base
        const newClient: any = {
            ...input,
            id,
            nombre: normalizeText(input.nombre),
            documento: normalizedDoc,
            estado: input.estado || 'ACTIVO',
            createdAt: now,
            updatedAt: now,
        };

        // Limpiar undefined para Firestore
        Object.keys(newClient).forEach(key => {
            if (newClient[key] === undefined) {
                delete newClient[key];
            }
        });

        const clientDoc = doc(clientsCollection, id);
        await setDoc(clientDoc, newClient);

        return newClient as Client;
    } catch (error) {
        console.error('Error creating client:', error);
        throw error;
    }
}

/**
 * Actualiza un cliente existente
 */
export async function updateClient(id: string, input: ClientUpdateInput): Promise<Client> {
    try {
        const clientDoc = doc(clientsCollection, id);
        const snapshot = await getDoc(clientDoc);

        if (!snapshot.exists()) {
            throw new Error(`Cliente con ID ${id} no encontrado`);
        }

        // Construir objeto de actualizaciones
        const updates: any = {
            ...input,
            updatedAt: new Date().toISOString(),
        };

        if (input.nombre) updates.nombre = normalizeText(input.nombre);
        if (input.documento) updates.documento = normalizeDocumento(input.documento);

        // Limpiar undefined para Firestore
        Object.keys(updates).forEach(key => {
            if (updates[key] === undefined) {
                delete updates[key];
            }
        });

        await updateDoc(clientDoc, updates);

        // Retornar cliente actualizado
        const updatedSnapshot = await getDoc(clientDoc);
        return {
            id: updatedSnapshot.id,
            ...updatedSnapshot.data()
        } as Client;
    } catch (error) {
        console.error('Error updating client:', error);
        throw error;
    }
}

/**
 * Desactiva un cliente (no se elimina)
 */
export async function deactivateClient(id: string): Promise<Client> {
    return updateClient(id, { estado: 'INACTIVO' });
}

/**
 * Reactiva un cliente
 */
export async function reactivateClient(id: string): Promise<Client> {
    return updateClient(id, { estado: 'ACTIVO' });
}

/**
 * Mueve un cliente al archivo (Baja operativa)
 */
export async function archiveClient(id: string, metadata: { motivo?: string, usuario?: string, nota?: string }): Promise<Client> {
    const now = new Date().toISOString();
    return updateClient(id, {
        estado: 'BAJA',
        fechaBaja: now,
        motivoBaja: metadata.motivo,
        usuarioBaja: metadata.usuario,
        notaBaja: metadata.nota
    });
}

/**
 * Restaura un cliente del archivo
 */
export async function restoreClient(id: string): Promise<Client> {
    return updateClient(id, {
        estado: 'ACTIVO',
        fechaBaja: undefined,
        motivoBaja: undefined,
        usuarioBaja: undefined,
        notaBaja: undefined
    } as any);
}

/**
 * Elimina permanentemente un cliente del sistema
 * ADVERTENCIA: Esta acción es irreversible
 */
export async function deleteClient(id: string): Promise<void> {
    try {
        const clientRef = doc(clientsCollection, id);
        await deleteDoc(clientRef);
    } catch (error) {
        console.error('Error deleting client:', error);
        throw error;
    }
}

/**
 * Obtiene todos los clientes activos (para cargar en contexto)
 */
export async function getActiveClients(): Promise<Client[]> {
    try {
        const q = query(clientsCollection, where('estado', '==', 'ACTIVO'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Client));
    } catch (error) {
        console.error('Error getting active clients:', error);
        return [];
    }
}

/**
 * Obtiene todos los clientes (activos e inactivos)
 */
export async function getAllClients(): Promise<Client[]> {
    try {
        const snapshot = await getDocs(clientsCollection);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Client));
    } catch (error) {
        console.error('Error getting all clients:', error);
        return [];
    }
}

/**
 * Detecta posibles duplicados de un cliente
 * Retorna clientes con documento idéntico o nombre muy similar + teléfono igual
 */
export async function findPossibleDuplicates(client: Client | ClientCreateInput): Promise<Client[]> {
    try {
        const allClients = await getAllClients();
        const duplicates: Client[] = [];

        const normalizedDoc = normalizeDocumento(client.documento || '');
        const normalizedTel = normalizeTelefono(client.telefono || '');

        for (const existing of allClients) {
            // Saltar si es el mismo cliente
            if ('id' in client && existing.id === client.id) continue;

            // Duplicado seguro: mismo documento
            if (normalizedDoc && normalizeDocumento(existing.documento || '') === normalizedDoc) {
                duplicates.push(existing);
                continue;
            }

            // Posible duplicado: nombre similar + mismo teléfono
            if (normalizedTel && normalizeTelefono(existing.telefono || '') === normalizedTel) {
                const nameSimilarity = calculateSimilarity(client.nombre, existing.nombre);
                if (nameSimilarity > 0.8) {
                    duplicates.push(existing);
                }
            }
        }

        return duplicates;
    } catch (error) {
        console.error('Error finding duplicates:', error);
        return [];
    }
}

// Helper: calcular similitud entre nombres
function calculateSimilarity(a: string, b: string): number {
    const normA = normalizeText(a);
    const normB = normalizeText(b);

    if (normA === normB) return 1;

    const longer = normA.length > normB.length ? normA : normB;
    const shorter = normA.length > normB.length ? normB : normA;

    if (longer.length === 0) return 1;

    // Implementación simple: caracteres en común / longitud
    let matches = 0;
    for (const char of shorter) {
        if (longer.includes(char)) matches++;
    }

    return matches / longer.length;
}
