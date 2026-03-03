
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { Client, ClientSearchParams, ClientFilters } from '@/types/client';
import { Search, Plus, FolderOpen, MoreHorizontal, Check, Users, Receipt, RefreshCw, X, List, FileText, FileCheck, Wallet, Eye, History, ChevronDown, Copy } from 'lucide-react';
import { useConfirmation } from '@/hooks/useConfirmation';
import ConfirmationModal from './ConfirmationModal';
import { useHashRouter } from '@/hooks/useHashRouter';
import { useAppContext } from '@/contexts/AppContext';
import { useToast } from '@/hooks/useToast';
import ClientDetailModal from './ClientDetailModal';
import ClientPreviewModal from './ClientPreviewModal';
import PaginationControls, { PageSize } from './PaginationControls';
import { ClientListFilter } from '@/types/clientList';
import { BackToHubButton } from './ui/BackToHubButton';
import { PremiumFilterButton } from './ui/PremiumFilterButton';
import ClientFilterPanel from './ClientFilterPanel';
import { getPaymentMethods } from '@/services/paymentMethodService';
import type { PaymentMethod } from '@/types/paymentMethod';
import Breadcrumbs from './ui/Breadcrumbs';
import { ColumnSelectorMenu, type ColumnSelectorOption } from './ui/ColumnSelectorMenu';
import { ColumnResizeToggle } from './ui/ColumnResizeToggle';
import {
    pushRecentClientIdentifier,
    readRecentClientIdentifiers,
    readActiveClientIdentifier,
    setActiveClientIdentifier,
    clearActiveClientIdentifier,
    type RecentClientIdentifierEntry
} from '@/utils/recentClientIdentifiers';
import { CopyAction } from './ui/ActionFeedback';
import { InputClearButton } from './ui/InputClearButton';


interface ClientExplorerProps {
    onReturnToDashboard?: () => void;
    embedded?: boolean;
    onSelect?: (client: Client) => void;
    selectionMode?: boolean;
}

const SHOW_CLIENT_SUMMARY = false; // Feature flag to show/hide the stats summary bar
const CLIENTS_VISIBLE_COLUMNS_KEY = 'clients-visible-columns-v1';
const FILTER_PANEL_AUTO_CLOSE_MS = 20000;
const CLIENT_FILTERS_PINNED_KEY = 'clients-filters-pinned';

const normalizeDoc = (value?: string | null) =>
    (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const ClientExplorer: React.FC<ClientExplorerProps> = ({
    onReturnToDashboard: _onReturnToDashboard,
    embedded = false,
    onSelect,
    selectionMode = false
}) => {
    const { navigateTo } = useHashRouter();
    const { caseHistory, savedClients, currentUser } = useAppContext();
    const { addToast } = useToast();

    // -- State --
    const [params, setParams] = useState<ClientSearchParams>({
        q: '',
        limit: 25 as PageSize,
        offset: 0,
        estado: 'ACTIVO',
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [items, setItems] = useState<Client[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [activeView, setActiveView] = useState<string>('all');
    const [activeFilters, setActiveFilters] = useState<ClientListFilter>({});

    // UI state
    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isListadosOpen, setIsListadosOpen] = useState(false);
    const [listadosTab, setListadosTab] = useState<'sistema' | 'mis-listas'>('sistema');
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
    const [isFilterPanelPinned, setIsFilterPanelPinned] = useState(() => {
        return localStorage.getItem(CLIENT_FILTERS_PINNED_KEY) === 'true';
    });
    const [clientFilters, setClientFilters] = useState<ClientFilters>({});
    const clientColumnOptions: ColumnSelectorOption[] = [
        { id: 'identifier', label: 'Identificador' },
        { id: 'client', label: 'Cliente' },
        { id: 'contact', label: 'Contacto' },
        { id: 'city', label: 'Domicilio' },
        { id: 'accounting', label: 'Cuenta contable' },
        { id: 'preview', label: 'Ficha' }
    ];
    const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem(CLIENTS_VISIBLE_COLUMNS_KEY);
            if (!raw) return clientColumnOptions.map(c => c.id);
            const parsed = JSON.parse(raw) as string[];
            const allowed = new Set(clientColumnOptions.map(c => c.id));
            const filtered = parsed.filter(id => allowed.has(id));
            return filtered.length > 0 ? filtered : clientColumnOptions.map(c => c.id);
        } catch {
            return clientColumnOptions.map(c => c.id);
        }
    });
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
    const [recentIdentifiers, setRecentIdentifiers] = useState<RecentClientIdentifierEntry[]>([]);
    const [isRecentsOpen, setIsRecentsOpen] = useState(false);

    // Menu contextual state
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const recentsRef = useRef<HTMLDivElement>(null);
    const visibleColumnsSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);
    const visibleColumnCount = visibleColumns.length + 1; // + acciones
    const hasClientExplorerCriteria = useMemo(() => {
        const hasSearch = searchTerm.trim().length > 0;
        const hasClientPanelFilters = Object.values(clientFilters).some(value => {
            if (value === undefined || value === null) return false;
            if (typeof value === 'string') return value.trim().length > 0;
            return true;
        });
        const hasSavedListSelection = activeView !== 'all' || Object.keys(activeFilters).length > 0;
        return hasSearch || hasClientPanelFilters || hasSavedListSelection;
    }, [searchTerm, clientFilters, activeView, activeFilters]);

    useEffect(() => {
        localStorage.setItem(CLIENTS_VISIBLE_COLUMNS_KEY, JSON.stringify(visibleColumns));
    }, [visibleColumns]);

    const getDisplayNameForIdentifier = useCallback((identifier: string) => {
        const normalized = normalizeDoc(identifier);
        if (!normalized) return '';

        const match = savedClients.find(client =>
            normalizeDoc(client.documento) === normalized ||
            normalizeDoc(client.nif) === normalized
        );

        return match?.nombre || match?.legalName || '';
    }, [savedClients]);

    useEffect(() => {
        const loaded = readRecentClientIdentifiers(currentUser?.id);
        setRecentIdentifiers(
            loaded.map(entry => ({
                identifier: entry.identifier,
                displayName: entry.displayName || getDisplayNameForIdentifier(entry.identifier)
            }))
        );
    }, [currentUser?.id, getDisplayNameForIdentifier]);

    useEffect(() => {
        if (searchTerm.trim().length > 0) return;
        const active = readActiveClientIdentifier();
        if (active) {
            setSearchTerm(active);
        }
    }, [searchTerm]);

    const toggleVisibleColumn = (id: string) => {
        setVisibleColumns(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
    };

    const pushRecentIdentifier = useCallback((rawIdentifier?: string, displayName = '') => {
        const normalized = (rawIdentifier || '').toString().trim().toUpperCase();
        if (!normalized) return;

        const updated = pushRecentClientIdentifier(currentUser?.id, normalized, displayName || getDisplayNameForIdentifier(normalized));
        setRecentIdentifiers(updated.map(entry => ({
            identifier: entry.identifier,
            displayName: entry.displayName || getDisplayNameForIdentifier(entry.identifier)
        })));
    }, [currentUser?.id, getDisplayNameForIdentifier]);

    // Preview state
    const [previewModalOpen, setPreviewModalOpen] = useState(false);
    const [previewClient, setPreviewClient] = useState<Client | null>(null);

    // Confirmation modal
    const { confirmationState, closeConfirmation } = useConfirmation();

    // Pre-index clients once to avoid expensive per-keystroke normalization work.
    const indexedClients = useMemo(() => {
        return savedClients.map(client => {
            const name = String(client.nombre || client.legalName || '').toLowerCase();
            const documento = String(client.documento || client.nif || '').toLowerCase();
            const telefono = String(client.telefono || client.phone || '').toLowerCase();
            const email = String(client.email || '').toLowerCase();
            const direccion = String(client.direccion || client.address || client.domicilioFiscal?.direccion || '').toLowerCase();
            const poblacion = String(client.poblacion || client.city || client.domicilioFiscal?.poblacion || '').toLowerCase();
            const provincia = String(client.province || client.domicilioFiscal?.provincia || '').toLowerCase();
            const cp = String(client.cp || client.postalCode || client.domicilioFiscal?.cp || '').toLowerCase();
            return {
                client,
                searchable: `${name}|${documento}|${telefono}|${email}|${direccion}|${poblacion}|${provincia}|${cp}`
            };
        });
    }, [savedClients]);


    // -- Memoized Data for Stats --
    const caseCounts = useMemo(() => {
        const counts: Record<string, number> = {};

        // Helper to normalize ID: keep alphanumeric but maybe strip distinct separators?
        // User said: "IDENTIFICADOR = DNI sin letra (solo números)"
        // So we try to match by strictly numeric version if possible.
        const normalize = (val?: string) => val ? val.replace(/\D/g, '') : '';

        const numericMap: Record<string, string> = {};
        const rawMap: Record<string, string> = {}; // Fallback for exact string match

        savedClients.forEach(c => {
            if (c.documento) {
                const num = normalize(c.documento);
                if (num.length >= 5) { // Avoid trivial matches
                    numericMap[num] = c.id;
                }
                rawMap[c.documento.trim().toUpperCase()] = c.id;
            }
        });

        caseHistory.forEach(c => {
            let targetId: string | null = null;

            // 1. Direct Link
            if (c.client?.id) {
                targetId = c.client.id;
            }
            // 2. String Match via ClienteId
            else if (c.clienteId) {
                const raw = c.clienteId.trim().toUpperCase();
                const numeric = normalize(raw);

                // Try Exact Match first
                if (rawMap[raw]) {
                    targetId = rawMap[raw];
                }
                // Try Numeric Match (e.g. Case "12345678" vs Client "12345678Z")
                else if (numeric.length >= 5 && numericMap[numeric]) {
                    targetId = numericMap[numeric];
                }
            }

            if (targetId) {
                counts[targetId] = (counts[targetId] || 0) + 1;
            }
        });
        return counts;
    }, [caseHistory, savedClients]);


    useMemo(() => {
        if (!SHOW_CLIENT_SUMMARY) return { totalClients: 0, totalCases: 0, clientsWithoutCases: 0, recentContacts: 0 };
        const totalClients = savedClients.length;
        const totalCases = caseHistory.length;
        const clientsWithCases = new Set(caseHistory.map(c => c.client?.id || c.clienteId).filter(Boolean)).size;
        const clientsWithoutCases = totalClients - clientsWithCases;

        // Recent contacts (updated in last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recentContacts = savedClients.filter(c => {
            const updatedDate = c.updatedAt ? new Date(c.updatedAt) : null;
            return updatedDate && updatedDate > sevenDaysAgo;
        }).length;

        return {
            totalClients,
            totalCases,
            clientsWithoutCases,
            recentContacts
        };
    }, [savedClients, caseHistory]);

    // -- Effects --
    useEffect(() => {
        const timer = setTimeout(() => {
            setParams(p => ({ ...p, q: searchTerm || undefined, offset: 0 }));
        }, 400);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // Close menu on scroll or click outside
    useEffect(() => {
        if (!openMenuId) return;

        const handleScroll = () => { setOpenMenuId(null); setMenuPos(null); };
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpenMenuId(null);
                setMenuPos(null);
            }
        };

        window.addEventListener('scroll', handleScroll, { capture: true });
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            window.removeEventListener('scroll', handleScroll, { capture: true });
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [openMenuId]);

    useEffect(() => {
        if (!isRecentsOpen) return;

        const handleOutsideClick = (event: MouseEvent) => {
            if (recentsRef.current && !recentsRef.current.contains(event.target as Node)) {
                setIsRecentsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [isRecentsOpen]);

    // -- Ghost Clients (Detected from Cases) --
    const ghostClients = useMemo(() => {
        const knownIds = new Set(savedClients.map(c => c.id));
        const knownDocs = new Set(savedClients.filter(c => c.documento).map(c => c.documento!.trim().toUpperCase()));

        const ghosts = new Map<string, Client>();

        caseHistory.forEach(c => {
            const rawId = c.clienteId?.trim().toUpperCase();
            if (!rawId) return;

            // Skip if linked object exists
            if (c.client?.id) return;

            // Skip if matches known Client ID or Document
            if (knownIds.has(rawId)) return;
            if (knownDocs.has(rawId)) return;

            // It's a ghost
            if (!ghosts.has(rawId)) {
                ghosts.set(rawId, {
                    id: rawId, // Use raw ID as temporary ID
                    tipo: 'PARTICULAR',
                    nombre: c.client?.nombre || c.clientSnapshot?.nombre || 'Cliente Detectado (Sin Ficha)',
                    documento: rawId,
                    estado: 'ACTIVO',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    email: c.client?.email || '',
                    telefono: c.client?.phone || c.client?.telefono || '',
                } as Client);
            }
        });

        return Array.from(ghosts.values());
    }, [caseHistory, savedClients]);

    const loadClients = useCallback(async () => {
        if (!hasClientExplorerCriteria) {
            setItems([]);
            setTotal(0);
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const normalizedQ = (params.q || '').toLowerCase().trim();
            const isNumericSearch = normalizedQ.length > 0 && /^\d+$/.test(normalizedQ);
            let fetchedItems = indexedClients
                .filter(entry => {
                    if (!normalizedQ) return true;
                    if (isNumericSearch) {
                        // Numeric search: prioritize document/phone/cp matches.
                        const docOrPhone = [
                            entry.client.documento,
                            entry.client.nif,
                            entry.client.telefono,
                            entry.client.phone,
                            entry.client.cp,
                            entry.client.postalCode,
                            entry.client.domicilioFiscal?.cp
                        ]
                            .map(value => String(value || '').toLowerCase())
                            .join('|');
                        return docOrPhone.includes(normalizedQ);
                    }
                    return entry.searchable.includes(normalizedQ);
                })
                .map(entry => entry.client);

            // 2. Filter & Merge Ghost Clients (Client-side logic)
            // Only show ghosts if we are searching (to avoid clutter) OR if activeView is 'all'/'detected'
            // User wanted them "SIEMPRE indexado por IDENTIFICADOR".

            const q = normalizedQ;
            const matchingGhosts = ghostClients.filter(g => {
                if (!q) return true;
                const ghostName = String(g.nombre ?? '').toLowerCase();
                const ghostDocument = String(g.documento ?? '').toLowerCase();
                const ghostId = String(g.id ?? '').toLowerCase();
                return (
                    ghostName.includes(q) ||
                    ghostDocument.includes(q) ||
                    ghostId.includes(q)
                );
            });

            // Combine (Real first, then Ghosts)
            const combined = [...fetchedItems];
            matchingGhosts.forEach(g => {
                // If the ghost ID or Document is already in the fetched items, skip it.
                // Fetch items are Real Clients.
                // Ghost Logic already filtered known IDs/Docs from SavedClients.
                // But searched items might be a subset, so we double check.
                if (!combined.some(c => c.id === g.id || (c.documento && g.documento && c.documento === g.documento))) {
                    combined.push(g);
                }
            });

            // ✅ FILTRAR CLIENTES INCOMPLETOS (registros parciales abandonados)
            // Excluir clientes que solo tienen ID pero no tienen datos mínimos
            const validClients = combined.filter(client => {
                // Un cliente válido debe tener al menos un nombre que no sea solo el ID
                const hasValidName = client.nombre &&
                    client.nombre.trim() !== '' &&
                    client.nombre !== client.id &&
                    !client.nombre.includes('undefined');

                return hasValidName;
            });

            // Client-side filtering for views
            let filteredItems = validClients;

            // Apply advanced filters from ClientList
            if (activeFilters.hasExpedientes !== undefined) {
                filteredItems = filteredItems.filter(c => activeFilters.hasExpedientes ? (caseCounts[c.id] || 0) > 0 : (caseCounts[c.id] || 0) === 0);
            }
            if (activeFilters.detectedAuto) {
                filteredItems = matchingGhosts;
            }
            if (activeFilters.missingContact) {
                filteredItems = filteredItems.filter(c => !c.email && !c.telefono);
            }
            if (activeFilters.incompleteAddress) {
                filteredItems = filteredItems.filter(c => {
                    const dom = c.domicilioFiscal || {};
                    return !dom.provincia || !dom.cp || !dom.pais;
                });
            }
            if (activeFilters.activeLastDays) {
                const threshold = new Date();
                threshold.setDate(threshold.getDate() - activeFilters.activeLastDays);
                filteredItems = filteredItems.filter(c => {
                    const date = c.updatedAt ? new Date(c.updatedAt) : null;
                    return date && date > threshold;
                });
            }
            if (activeFilters.createdLastDays) {
                const threshold = new Date();
                threshold.setDate(threshold.getDate() - activeFilters.createdLastDays);
                filteredItems = filteredItems.filter(c => c.fechaInicio && new Date(c.fechaInicio) > threshold);
            }
            if (activeFilters.recentObservationsDays) {
                const threshold = new Date();
                threshold.setDate(threshold.getDate() - activeFilters.recentObservationsDays);
                filteredItems = filteredItems.filter(c => (c.observaciones || []).some(o => o.fecha && new Date(o.fecha) > threshold));
            }

            // Apply new client filter panel criteria
            if (clientFilters.tipo) {
                filteredItems = filteredItems.filter(c => c.tipo === clientFilters.tipo);
            }

            if (clientFilters.provincia) {
                filteredItems = filteredItems.filter(c =>
                    c.domicilioFiscal?.provincia === clientFilters.provincia
                );
            }

            if (clientFilters.poblacion) {
                filteredItems = filteredItems.filter(c =>
                    c.domicilioFiscal?.poblacion === clientFilters.poblacion
                );
            }

            if (clientFilters.metodoCobro) {
                filteredItems = filteredItems.filter(c =>
                    c.formaCobroId === clientFilters.metodoCobro
                );
            }

            if (clientFilters.bancoCobro) {
                filteredItems = filteredItems.filter(c =>
                    c.bancoCobro === clientFilters.bancoCobro
                );
            }

            if (clientFilters.identificadorDesde || clientFilters.identificadorHasta) {
                filteredItems = filteredItems.filter(c => {
                    if (!c.documento) return false;
                    const docNum = parseInt(c.documento.replace(/\D/g, ''), 10);
                    if (isNaN(docNum)) return false;

                    const desde = clientFilters.identificadorDesde
                        ? parseInt(clientFilters.identificadorDesde, 10)
                        : 0;
                    const hasta = clientFilters.identificadorHasta
                        ? parseInt(clientFilters.identificadorHasta, 10)
                        : Infinity;

                    return docNum >= desde && docNum <= hasta;
                });
            }

            // Sorting
            const sortBy = activeFilters.sortBy || 'nombre';
            const sortDir = activeFilters.sortDir || 'asc';

            filteredItems.sort((a, b) => {
                let valA: any = '';
                let valB: any = '';

                if (sortBy === 'nombre') {
                    valA = a.nombre;
                    valB = b.nombre;
                } else if (sortBy === 'identificador') {
                    valA = a.documento || '';
                    valB = b.documento || '';
                } else if (sortBy === 'exps') {
                    valA = caseCounts[a.id] || 0;
                    valB = caseCounts[b.id] || 0;
                } else if (sortBy === 'ultimaActividad') {
                    valA = a.updatedAt;
                    valB = b.updatedAt;
                }

                if (valA < valB) return sortDir === 'asc' ? -1 : 1;
                if (valA > valB) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });

            // Legacy support...
            if (Object.keys(activeFilters).length === 0) {
                if (activeView === 'no_cases') {
                    filteredItems = filteredItems.filter(c => (caseCounts[c.id] || 0) === 0);
                } else if (activeView === 'with_cases') {
                    filteredItems = filteredItems.filter(c => (caseCounts[c.id] || 0) > 0);
                } else if (activeView === 'detected') {
                    filteredItems = matchingGhosts;
                } else if (activeView === 'no_email') {
                    filteredItems = filteredItems.filter(c => !c.email);
                } else if (activeView === 'no_phone') {
                    filteredItems = filteredItems.filter(c => !c.telefono);
                }
            }

            const filteredTotal = filteredItems.length;
            const offset = params.offset || 0;
            const limit = params.limit === 'all' ? filteredTotal : (params.limit as number);
            const paginated = params.limit === 'all'
                ? filteredItems
                : filteredItems.slice(offset, offset + limit);

            setItems(paginated);
            setTotal(filteredTotal);
        } catch (error) {
            console.error("Error loading clients:", error);
            addToast("Error al cargar la lista de clientes", "error");
        } finally {
            setLoading(false);
        }
    }, [params, activeView, caseCounts, addToast, ghostClients, activeFilters, clientFilters, hasClientExplorerCriteria, indexedClients]);

    useEffect(() => {
        loadClients();
    }, [loadClients, activeFilters]);

    // Load payment methods for filter panel
    useEffect(() => {
        getPaymentMethods().then(setPaymentMethods).catch(console.error);
    }, []);

    // -- Handlers --
    const handleSelectClient = (clientId: string) => {
        setSelectedClientId(clientId === selectedClientId ? null : clientId);
        const selected = items.find(c => c.id === clientId);
        if (selected?.documento) {
            pushRecentIdentifier(selected.documento, selected.nombre || selected.legalName || '');
            setActiveClientIdentifier(currentUser?.id, selected.documento, selected.nombre || selected.legalName || '');
        }
    };



    const getAddressDisplay = (client: Client) => {
        const domicilio = (client.domicilioFiscal || {}) as {
            sigla?: string;
            via?: string;
            numero?: string;
            piso?: string;
            puerta?: string;
            cp?: string;
            poblacion?: string;
            provincia?: string;
        };

        const streetLine = [
            domicilio.sigla,
            domicilio.via,
            domicilio.numero ? `nº ${domicilio.numero}` : '',
            domicilio.piso ? `${domicilio.piso}º` : '',
            domicilio.puerta || ''
        ].filter(Boolean).join(' ').trim() || client.via || client.address || client.direccion || '-';

        const cp = domicilio.cp || client.cp || client.postalCode || '';
        const poblacion = domicilio.poblacion || client.poblacion || client.city || '';
        const provincia = domicilio.provincia || client.province || '';

        const localityLine = [
            cp,
            poblacion,
            provincia ? `(${provincia})` : ''
        ].filter(Boolean).join(' ').trim() || '-';

        return {
            streetLine,
            localityLine
        };
    };

    const handleSelectView = (id: string, filters: ClientListFilter, _fields?: any[]) => {
        setActiveView(id);
        setActiveFilters(filters);
        setParams(p => ({ ...p, offset: 0 }));
    };


    // Calculate active filter count
    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (clientFilters.tipo) count++;
        if (clientFilters.provincia) count++;
        if (clientFilters.poblacion) count++;
        if (clientFilters.metodoCobro) count++;
        if (clientFilters.bancoCobro) count++;
        if (clientFilters.identificadorDesde) count++;
        if (clientFilters.identificadorHasta) count++;
        return count;
    }, [clientFilters]);

    useEffect(() => {
        localStorage.setItem(CLIENT_FILTERS_PINNED_KEY, String(isFilterPanelPinned));
    }, [isFilterPanelPinned]);

    // ✅ Cerrar automáticamente el panel de filtros después de inactividad
    useEffect(() => {
        // Solo cerrar si el panel está abierto Y no hay filtros activos
        if (isFilterPanelOpen && activeFilterCount === 0 && !isFilterPanelPinned) {
            // Esperar un margen amplio de inactividad antes de cerrar
            const timer = setTimeout(() => {
                setIsFilterPanelOpen(false);
            }, FILTER_PANEL_AUTO_CLOSE_MS);

            return () => clearTimeout(timer);
        }
    }, [isFilterPanelOpen, activeFilterCount, isFilterPanelPinned]);

    const handleClearFilters = () => {
        setClientFilters({});
    };

    return (
        <div className={`flex h-full w-full ${embedded ? 'bg-white' : 'bg-slate-50 font-sans overflow-hidden'}`}>

            {/* --- FILTER PANEL (LEFT SIDE - PUSH CONTENT) --- */}
            <ClientFilterPanel
                filters={clientFilters}
                onFiltersChange={setClientFilters}
                onClose={() => setIsFilterPanelOpen(false)}
                paymentMethods={paymentMethods}
                isOpen={isFilterPanelOpen}
                isPinned={isFilterPanelPinned}
                onTogglePin={() => setIsFilterPanelPinned(prev => !prev)}
            />

            {/* --- MAIN CONTENT (Protagonist) --- */}
            <main className={`flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-white transition-all duration-300 ease-in-out ${isFilterPanelOpen ? 'ml-0' : 'ml-0'
                }`}>
                {/* Right Panel Header */}
                <div className="px-10 py-8 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-6">
                        <div className="app-tab app-tab-active cursor-default !py-1 !px-0 !h-auto">
                            Gestión de Clientes
                        </div>

                        {!embedded && (
                            <>
                                <Breadcrumbs
                                    items={[]}
                                    className="hidden lg:flex"
                                />
                                <BackToHubButton />
                            </>
                        )}
                        <div className="relative group">
                            <button
                                onClick={() => setIsListadosOpen(!isListadosOpen)}
                                aria-label="Listados"
                                className={`relative flex items-center justify-center w-11 h-11 border rounded-2xl shadow-sm transition-all duration-300 active:scale-95 ${isListadosOpen
                                    ? 'bg-[#EBF5FF] border-[#B2D7FF]'
                                    : 'bg-[#FAFAFA] border-slate-200 hover:bg-[#EBF5FF] hover:border-[#B2D7FF]'
                                    }`}
                                title="Abrir menú de listados"
                            >
                                <List className={`w-5 h-5 transition-colors duration-300 ${isListadosOpen ? 'text-[#0071E3]' : 'text-slate-600 group-hover:text-[#0071E3]'}`} />
                            </button>
                            <span className="pointer-events-none absolute top-full mt-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-slate-800 text-white text-[9px] font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-300 shadow-xl z-50 whitespace-nowrap tracking-wider">
                                LISTADOS
                                <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-800 rotate-45" />
                            </span>
                        </div>

                        <PremiumFilterButton
                            isActive={isFilterPanelOpen}
                            onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                            tooltip={`Filtrar clientes${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}
                        />

                        <ColumnSelectorMenu
                            title="Columnas"
                            options={clientColumnOptions}
                            visibleIds={visibleColumns}
                            onToggle={toggleVisibleColumn}
                            iconOnly
                        />
                        <ColumnResizeToggle />

                        {/* Active filter chips */}
                        {activeFilterCount > 0 && (
                            <div className="flex items-center gap-2 px-3 py-1 bg-sky-50 border border-sky-100 rounded-full">
                                <div className="size-1.5 rounded-full bg-sky-400" />
                                <span className="text-[10px] font-normal uppercase tracking-widest text-sky-700">
                                    {activeFilterCount} filtro{activeFilterCount > 1 ? 's' : ''} activo{activeFilterCount > 1 ? 's' : ''}
                                </span>
                                <button
                                    onClick={handleClearFilters}
                                    className="text-sky-400 hover:text-sky-600 transition-colors ml-1"
                                    title="Limpiar filtros"
                                >
                                    <X size={10} strokeWidth={3} />
                                </button>
                            </div>
                        )}

                        {activeView !== 'all' && (
                            <div className="flex items-center gap-2 px-3 py-1 bg-sky-50 border border-sky-100 rounded-full">
                                <div className="size-1.5 rounded-full bg-sky-400" />
                                <span className="text-[10px] font-normal uppercase tracking-widest text-sky-700">{activeView}</span>
                                <button
                                    onClick={() => handleSelectView('all', {})}
                                    className="text-sky-400 hover:text-sky-600 transition-colors ml-1"
                                >
                                    <X size={10} strokeWidth={3} />
                                </button>
                            </div>
                        )}


                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative group">
                            <button
                                onClick={() => { setEditingId(null); setModalOpen(true); }}
                                aria-label="Nuevo Cliente"
                                className="relative flex items-center justify-center w-11 h-11 bg-blue-50/60 border border-blue-100 rounded-2xl shadow-sm transition-all duration-300 hover:bg-[#EBF5FF] hover:border-[#B2D7FF] hover:scale-110 active:scale-95"
                                title="Crear nuevo cliente"
                            >
                                <Plus className="w-5 h-5 text-[#0071E3]" strokeWidth={2.5} />
                            </button>
                            <span className="pointer-events-none absolute top-full mt-3 right-0 px-3 py-1.5 bg-slate-800 text-white text-[9px] font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-300 shadow-xl z-50 whitespace-nowrap tracking-wider">
                                NUEVO CLIENTE
                                <span className="absolute -top-1 right-4 w-2 h-2 bg-slate-800 rotate-45" />
                            </span>
                        </div>
                    </div>
                </div>

                {/* Search Protagonist Area */}
                <div className="px-10 py-6 bg-slate-50/50 border-b border-slate-100">
                    <div className="relative group/search max-w-2xl">
                        <Search size={20} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within/search:text-sky-600" />
                        <input
                            type="text"
                            placeholder="Buscar por Nombre, DNI, Email, Teléfono, Dirección, Población, Provincia, CP..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full h-14 pl-14 pr-36 bg-white border border-slate-200 rounded-2xl text-base font-normal text-slate-900 placeholder:text-slate-300 focus:ring-4 focus:ring-sky-500/5 focus:border-sky-500 outline-none transition-all shadow-sm"
                        />
                        {searchTerm.trim().length > 0 && (
                            <InputClearButton
                                onClick={() => {
                                    setSearchTerm('');
                                    setIsRecentsOpen(false);
                                }}
                                className="absolute right-32 top-1/2 -translate-y-1/2"
                                title="Limpiar búsqueda"
                            />
                        )}
                        <div ref={recentsRef} className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    clearActiveClientIdentifier();
                                    setSearchTerm('');
                                    setIsRecentsOpen(false);
                                }}
                                className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-500 transition-colors"
                                title="Limpiar contexto global de cliente"
                                aria-label="Limpiar contexto global de cliente"
                            >
                                <X size={14} />
                            </button>
                            <button
                                onClick={() => setIsRecentsOpen(v => !v)}
                                className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 transition-colors"
                                title="Identificadores recientes de esta sesión"
                            >
                                <History size={14} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">Recientes</span>
                                <ChevronDown size={12} className={`transition-transform ${isRecentsOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {isRecentsOpen && (
                                <div className="absolute right-0 top-[calc(100%+8px)] w-64 rounded-xl border border-slate-200 bg-white shadow-xl z-30 overflow-hidden">
                                    <div className="px-3 py-2 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50">
                                        Últimos identificadores
                                    </div>
                                    {recentIdentifiers.length === 0 ? (
                                        <div className="px-3 py-3 text-xs text-slate-400">
                                            Sin identificadores en esta sesión.
                                        </div>
                                    ) : (
                                        <div className="max-h-56 overflow-auto">
                                            {recentIdentifiers.map((recent) => {
                                                const resolvedName = recent.displayName || getDisplayNameForIdentifier(recent.identifier);
                                                return (
                                                <button
                                                    key={recent.identifier}
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        setSearchTerm(recent.identifier);
                                                        pushRecentIdentifier(recent.identifier, resolvedName);
                                                        setActiveClientIdentifier(currentUser?.id, recent.identifier, resolvedName);
                                                        setIsRecentsOpen(false);
                                                    }}
                                                    className="w-full text-left px-3 py-2 hover:bg-sky-50 border-b border-slate-50 last:border-0"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-sm font-semibold text-slate-700">{recent.identifier}</span>
                                                        <span className="text-xs text-slate-500 truncate ml-auto">{resolvedName || '-'}</span>
                                                    </div>
                                                </button>
                                            );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Table Container */}
                <div className="flex-1 overflow-auto px-10 py-6 scrollbar-thin">
                    <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                        <table className="w-full text-left border-collapse bg-white">
                            <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-100">
                                    {visibleColumnsSet.has('identifier') && <th className="px-6 py-4 text-xs font-medium text-slate-500">Identificador</th>}
                                    {visibleColumnsSet.has('client') && <th className="px-6 py-4 text-xs font-medium text-slate-500">Cliente</th>}
                                    {visibleColumnsSet.has('contact') && <th className="px-6 py-4 text-xs font-medium text-slate-500">Contacto</th>}
                                    {visibleColumnsSet.has('city') && <th className="px-6 py-4 text-xs font-medium text-slate-500">Domicilio</th>}
                                    {visibleColumnsSet.has('accounting') && <th className="px-6 py-4 text-xs font-medium text-slate-500">Cuenta contable</th>}
                                    {visibleColumnsSet.has('preview') && <th className="px-6 py-4 text-xs font-medium text-slate-500 text-center">Ficha</th>}
                                    <th className="px-6 py-4 text-xs font-medium text-slate-500 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan={visibleColumnCount} className="py-24 text-center">
                                            <div className="flex flex-col items-center gap-3 text-slate-300">
                                                <RefreshCw className="animate-spin" size={32} />
                                                <span className="text-xs font-bold uppercase tracking-widest">Cargando base de datos...</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : items.length === 0 ? (
                                    <tr>
                                        <td colSpan={visibleColumnCount} className="py-24 text-center">
                                            <div className="flex flex-col items-center gap-3 text-slate-300">
                                                <X size={32} />
                                                <p className="text-sm font-medium">
                                                    {hasClientExplorerCriteria
                                                        ? 'No se han encontrado registros con estos criterios.'
                                                        : 'Aplica un filtro o realiza una búsqueda para mostrar clientes.'}
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : items.map((client) => {
                                    const isSelected = selectedClientId === client.id;
                                    return (
                                        <tr
                                            key={client.id}
                                            onClick={() => handleSelectClient(client.id)}
                                            onDoubleClick={() => {
                                                if (selectionMode && onSelect) {
                                                    onSelect(client);
                                                } else {
                                                    setEditingId(client.id);
                                                    setModalOpen(true);
                                                }
                                            }}
                                            className={`group cursor-pointer transition-all hover:bg-slate-50/50 ${isSelected ? 'bg-sky-50/30' : ''}`}
                                        >
                                            {visibleColumnsSet.has('identifier') && <td className="px-6 py-5">
                                                {client.documento ? (
                                                    <CopyAction text={client.documento}>
                                                        <div className="inline-flex items-center gap-1 group/copy">
                                                            <span className="text-xs font-medium text-sky-600 hover:underline">{client.documento}</span>
                                                            <Copy size={11} className="text-slate-300 group-hover/copy:text-sky-500" />
                                                        </div>
                                                    </CopyAction>
                                                ) : (
                                                    <span className="text-xs font-medium text-sky-600">-</span>
                                                )}
                                            </td>}
                                            {visibleColumnsSet.has('client') && <td className="px-6 py-5">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-normal text-slate-700 group-hover:text-sky-600 transition-colors">{client.nombre}</span>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        {client.nombre.includes('(Sin Ficha)') && (
                                                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[8px] uppercase font-bold tracking-widest border border-amber-100">Detectado</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>}
                                            {visibleColumnsSet.has('contact') && <td className="px-6 py-5">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-xs font-medium text-slate-600">{client.telefono || '-'}</span>
                                                    <span className="text-[10px] text-slate-400">{client.email || '-'}</span>
                                                </div>
                                            </td>}
                                            {visibleColumnsSet.has('city') && (
                                                <td className="px-6 py-5">
                                                    {(() => {
                                                        const address = getAddressDisplay(client);
                                                        return (
                                                            <div className="flex flex-col gap-0.5">
                                                                <span className="text-[10px] font-medium text-slate-600 truncate">
                                                                    {address.streetLine}
                                                                </span>
                                                                <span className="text-[10px] text-slate-500 uppercase tracking-wider truncate">
                                                                    {address.localityLine}
                                                                </span>
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                            )}
                                            {visibleColumnsSet.has('accounting') && (
                                                <td className="px-6 py-5">
                                                    <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                                                        {client.cuentaContable?.trim() || '-'}
                                                    </span>
                                                </td>
                                            )}
                                            {visibleColumnsSet.has('preview') && <td className="px-6 py-5 text-center">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setPreviewClient(client);
                                                        setPreviewModalOpen(true);
                                                    }}
                                                    className="inline-flex items-center justify-center p-2 rounded-lg text-sky-600 hover:bg-sky-50 transition-colors group/preview"
                                                    title="Vista Previa de la Ficha"
                                                >
                                                    <Eye size={18} className="group-hover/preview:scale-110 transition-transform" />
                                                </button>
                                            </td>}
                                            <td className="px-6 py-5 text-right">
                                                <div className="flex items-center justify-end">
                                                    {/* Menú contextual de acciones */}
                                                    <div className="relative">
                                                        {selectionMode && onSelect ? (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onSelect(client);
                                                                }}
                                                                className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-sky-700 transition-all shadow-sm active:scale-95 flex items-center gap-2"
                                                            >
                                                                <Check size={14} /> Seleccionar
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (openMenuId === client.id) {
                                                                        setOpenMenuId(null);
                                                                        setMenuPos(null);
                                                                    } else {
                                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                                        let top = rect.bottom + 6;
                                                                        let left = rect.right - 192;
                                                                        if (left < 16) left = 16;
                                                                        if (top + 300 > window.innerHeight) top = rect.top - 300;
                                                                        setMenuPos({ top, left });
                                                                        setOpenMenuId(client.id);
                                                                    }
                                                                }}
                                                                className={`p-2 rounded-lg transition-all duration-150 ${openMenuId === client.id ? 'bg-slate-200 text-slate-700 opacity-100' : 'text-slate-400 opacity-50 hover:opacity-100 hover:bg-slate-100'}`}
                                                            >
                                                                <MoreHorizontal className="w-4 h-4" />
                                                            </button>
                                                        )}

                                                        {openMenuId === client.id && menuPos && (
                                                            <div
                                                                ref={menuRef}
                                                                style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
                                                                className="w-48 bg-white border border-slate-200 rounded-lg shadow-xl z-[9999] py-1"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <button
                                                                    onClick={() => { navigateTo(`/?clientId=${client.id}`); setOpenMenuId(null); setMenuPos(null); }}
                                                                    className="w-full text-left px-3 py-2 text-xs font-normal text-slate-600 hover:bg-slate-50 hover:text-sky-600 flex items-center gap-2"
                                                                >
                                                                    <FolderOpen className="w-3.5 h-3.5" /> Expedientes
                                                                </button>
                                                                <button
                                                                    onClick={() => { navigateTo(`/billing?clientId=${client.id}`); setOpenMenuId(null); setMenuPos(null); }}
                                                                    className="w-full text-left px-3 py-2 text-xs font-normal text-slate-600 hover:bg-slate-50 hover:text-indigo-600 flex items-center gap-2"
                                                                >
                                                                    <FileText className="w-3.5 h-3.5" /> Albaranes
                                                                </button>
                                                                <button
                                                                    onClick={() => { navigateTo(`/proformas?clientId=${client.id}`); setOpenMenuId(null); setMenuPos(null); }}
                                                                    className="w-full text-left px-3 py-2 text-xs font-normal text-slate-600 hover:bg-slate-50 hover:text-violet-600 flex items-center gap-2"
                                                                >
                                                                    <FileCheck className="w-3.5 h-3.5" /> Proformas
                                                                </button>
                                                                <button
                                                                    onClick={() => { navigateTo(`/client-billing?clientId=${client.id}`); setOpenMenuId(null); setMenuPos(null); }}
                                                                    className="w-full text-left px-3 py-2 text-xs font-normal text-slate-600 hover:bg-slate-50 hover:text-emerald-600 flex items-center gap-2"
                                                                >
                                                                    <Receipt className="w-3.5 h-3.5" /> Facturas
                                                                </button>
                                                                <button
                                                                    onClick={() => { navigateTo(`/client-billing?clientId=${client.id}`); setOpenMenuId(null); setMenuPos(null); }}
                                                                    className="w-full text-left px-3 py-2 text-xs font-normal text-slate-600 hover:bg-slate-50 hover:text-amber-600 flex items-center gap-2"
                                                                >
                                                                    <Wallet className="w-3.5 h-3.5" /> Económico
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {hasClientExplorerCriteria && (
                        <div className="mt-8 border border-slate-100 rounded-2xl bg-white shadow-sm overflow-hidden shrink-0">
                            <PaginationControls
                                currentPage={Math.floor((params.offset || 0) / (params.limit === 'all' ? (total || 1) : (params.limit as number))) + 1}
                                totalPages={params.limit === 'all' ? 1 : Math.ceil(total / (params.limit as number))}
                                pageSize={params.limit as PageSize}
                                totalItems={total}
                                onPageChange={(page) => setParams(p => ({ ...p, offset: (page - 1) * (p.limit === 'all' ? total : (p.limit as number)) }))}
                                onPageSizeChange={(size) => setParams(p => ({ ...p, limit: size, offset: 0 }))}
                            />
                        </div>
                    )}
                </div>
            </main>

            {/* --- MODALS --- */}
            {modalOpen && (
                <ClientDetailModal
                    clientId={editingId}
                    onClose={() => setModalOpen(false)}
                    onSelectClient={(id) => setEditingId(id)}
                    onSaved={() => {
                        setModalOpen(false);
                        loadClients();
                        addToast("Guardado correctamente", "success");
                    }}
                />
            )}

            {previewClient && (
                <ClientPreviewModal
                    isOpen={previewModalOpen}
                    onClose={() => setPreviewModalOpen(false)}
                    client={previewClient}
                    caseCount={caseCounts[previewClient.id] || 0}
                    onEdit={() => {
                        setPreviewModalOpen(false);
                        setEditingId(previewClient.id);
                        setModalOpen(true);
                    }}
                />
            )}

            {/* --- LISTADOS DROPDOWN --- */}
            {isListadosOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-black/20 z-40 animate-in fade-in duration-200"
                        onClick={() => setIsListadosOpen(false)}
                    />

                    {/* Dropdown Panel */}
                    <div className="fixed top-24 left-1/2 -translate-x-1/2 w-[600px] bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 animate-in slide-in-from-top-4 duration-300">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-slate-900">Listados</h3>
                            <button
                                onClick={() => setIsListadosOpen(false)}
                                className="size-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Tabs */}
                        <div className="flex border-b border-slate-100">
                            <button
                                onClick={() => setListadosTab('sistema')}
                                className={`flex-1 px-6 py-3 text-sm font-bold uppercase tracking-wider transition-all ${listadosTab === 'sistema'
                                    ? 'text-sky-700 border-b-2 border-sky-600 bg-sky-50/50'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                    }`}
                            >
                                Sistema
                            </button>
                            <button
                                onClick={() => setListadosTab('mis-listas')}
                                className={`flex-1 px-6 py-3 text-sm font-bold uppercase tracking-wider transition-all ${listadosTab === 'mis-listas'
                                    ? 'text-sky-700 border-b-2 border-sky-600 bg-sky-50/50'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                    }`}
                            >
                                Mis Listas
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-8">
                            {listadosTab === 'sistema' ? (
                                <div className="text-center py-12">
                                    <div className="size-16 mx-auto mb-4 rounded-full bg-sky-50 flex items-center justify-center">
                                        <List className="w-8 h-8 text-sky-600" />
                                    </div>
                                    <p className="text-sm font-medium text-slate-600">Contenido de Sistema</p>
                                    <p className="text-xs text-slate-400 mt-1">Próximamente...</p>
                                </div>
                            ) : (
                                <div className="text-center py-12">
                                    <div className="size-16 mx-auto mb-4 rounded-full bg-indigo-50 flex items-center justify-center">
                                        <Users className="w-8 h-8 text-indigo-600" />
                                    </div>
                                    <p className="text-sm font-medium text-slate-600">Contenido de Mis Listas</p>
                                    <p className="text-xs text-slate-400 mt-1">Próximamente...</p>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* Confirmation Modal */}
            <ConfirmationModal
                isOpen={confirmationState.isOpen}
                onClose={closeConfirmation}
                onConfirm={confirmationState.onConfirm}
                title={confirmationState.title}
                message={confirmationState.message}
                description={confirmationState.description}
                confirmText={confirmationState.confirmText}
                cancelText={confirmationState.cancelText}
                variant={confirmationState.variant}
            />
        </div>
    );
};

export default ClientExplorer;
