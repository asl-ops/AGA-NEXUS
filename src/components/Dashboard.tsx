import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Copy, Printer, Trash2, ArrowUpRight, Eye, Search, X, MoreHorizontal, FileText, Edit3, Receipt, History, ChevronDown, Hash, Info, FolderPlus, Undo2, Columns2, Package, BadgeEuro, Pin } from 'lucide-react';
import { useAppContext } from '../contexts/AppContext';
import { useToast } from '../hooks/useToast';
import { useBilling } from '../hooks/useBilling';
import { useProformas } from '../hooks/useProformas';
import PaginationControls from './PaginationControls';
import DashboardModals from './DashboardModals';
import { ResizableExplorerTable } from './ui/ResizableExplorerTable';
import CasePreviewModal from './CasePreviewModal';
import { CaseRecord, CaseStatus, PrefixConfig } from '../types';
import type { PageSize } from './PaginationControls';
import { getPrefixes } from '../services/prefixService';
import { cn } from '../utils/cn';
import { BackToHubButton } from './ui/BackToHubButton';
import ExpedienteFilterPanel, { ExpedienteFilters } from './ExpedienteFilterPanel';
import Breadcrumbs from './ui/Breadcrumbs';
import { ColumnSelectorMenu, type ColumnSelectorOption } from './ui/ColumnSelectorMenu';
import { PremiumFilterButton } from './ui/PremiumFilterButton';
import { InputClearButton } from './ui/InputClearButton';
import { ColumnResizeToggle } from './ui/ColumnResizeToggle';
import {
    consumeDashboardReturnContext,
    saveDashboardReturnContext,
    type DashboardReturnContext,
    type DashboardSortConfig
} from '@/utils/dashboardReturnContext';
import { navigateToModule } from '@/utils/moduleNavigation';
import { CopyAction } from './ui/ActionFeedback';
import {
    buildPathWithClientNavigation,
    clearClientNavigationContext,
    extractClientNavigationFromHash,
    readClientNavigationContext,
    saveClientNavigationContext
} from '@/utils/clientNavigationContext';
import {
    clearIdentifierContext,
    getIdentifierContextChangedEventName,
    readEffectiveClientIdentifier,
    readIsIdentifierPinned,
    readPinnedIdentifier,
    pushRecentClientIdentifier,
    readRecentClientIdentifiers,
    setActiveClientIdentifier,
    setPinnedClientIdentifier,
    unpinClientIdentifier,
    normalizeRecentClientIdentifier,
    type RecentClientIdentifierEntry
} from '@/utils/recentClientIdentifiers';
import { toUiTitleCase } from '@/utils/titleCase';

interface DashboardProps {
    onSelectCase: (caseId: string) => void;
    onCreateNewCase: (type?: string, initialClientId?: string) => void;
    onShowResponsibleDashboard: () => void;
}

interface SearchSuggestion {
    label: string;
    document: string;
    type: 'name' | 'doc';
    clientId?: string;
}

type ClientNavigationTab = 'expedientes' | 'albaranes' | 'facturas' | 'economico';

const normalizeIdentifier = (value?: string | null) =>
    (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const DASHBOARD_VISIBLE_COLUMNS_KEY = 'dashboard-visible-columns-v1';
const FILTER_PANEL_AUTO_CLOSE_MS = 20000;
const DASHBOARD_FILTERS_PINNED_KEY = 'dashboard-expediente-filters-pinned';

const getCaseBalance = (caseRecord: CaseRecord): number => {
    const economicTotal = Number(caseRecord.economicData?.totalAmount ?? 0);
    const rawDebe = Number((caseRecord as any).sourceSaldoDebe ?? 0);
    const rawHaber = Number((caseRecord as any).sourceSaldoHaber ?? 0);
    const importedBalance = (Number.isFinite(rawDebe) ? rawDebe : 0) - (Number.isFinite(rawHaber) ? rawHaber : 0);

    if (economicTotal !== 0) return economicTotal;
    if (Number.isFinite(rawDebe) || Number.isFinite(rawHaber)) return importedBalance;
    return 0;
};

const getFullClientName = (caseRecord: CaseRecord, clientsByIdentifier: Map<string, string>): string => {
    const identifier = normalizeIdentifier(caseRecord.clientSnapshot?.documento || caseRecord.client.nif || '');
    const canonicalName = identifier ? clientsByIdentifier.get(identifier) : '';
    const snapshotName = caseRecord.clientSnapshot?.nombre || `${caseRecord.client.firstName} ${caseRecord.client.surnames}` || 'Sin Titular';
    return canonicalName?.trim() || snapshotName;
};

const Dashboard: React.FC<DashboardProps> = ({
    onSelectCase,
    onCreateNewCase,
    onShowResponsibleDashboard: _onShowResponsibleDashboard,
}) => {
    const { caseHistory, savedClients, appSettings, saveMultipleCases, users, currentUser, updateCaseHistory } = useAppContext();
    const { addToast } = useToast();
    const { createDeliveryNoteFromCase } = useBilling();
    const { createProformaFromCase } = useProformas();
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [selectedClientLabel, setSelectedClientLabel] = useState('');
    const [identifierFilter, setIdentifierFilter] = useState('');
    const [prefixFilter, setPrefixFilter] = useState('');
    const [responsibleFilter, setResponsibleFilter] = useState<string>('');
    const [responsibleLabel, setResponsibleLabel] = useState<string>('');
    const [statusFilter, setStatusFilter] = useState('Todos');
    const [categoryFilter, setCategoryFilter] = useState('Todos');
    const [prefixes, setPrefixes] = useState<PrefixConfig[]>([]);
    const [situationFilter, setSituationFilter] = useState('Todos');
    const [dateFilterType, setDateFilterType] = useState<'createdAt' | 'closedAt'>('createdAt');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [_caseToDelete, _setCaseToDelete] = useState<string | null>(null);
    const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);
    const [_isReportsModuleOpen, _setIsReportsModuleOpen] = useState(false);
    const [sortConfig, setSortConfig] = useState<DashboardSortConfig | null>(null);
    const [isBatchCloseModalOpen, setIsBatchCloseModalOpen] = useState(false);
    const [_caseToClose, _setCaseToClose] = useState<CaseRecord | null>(null);
    const [caseToPrint, setCaseToPrint] = useState<CaseRecord | null>(null);
    const [previewCase, setPreviewCase] = useState<CaseRecord | null>(null);

    // Resizable sidebar state
    const [_isResizing, _setIsResizing] = useState(false);
    const [_sidebarWidth, _setSidebarWidth] = useState(320);
    const [selectedCases, setSelectedCases] = useState<string[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState<PageSize>(25);

    const [searchQuery, setSearchQuery] = useState('');
    const [isDeferredCasesLoading, setIsDeferredCasesLoading] = useState(false);

    // Menu contextual state
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // New Expediente Filter Panel state
    const [isExpedienteFilterPanelOpen, setIsExpedienteFilterPanelOpen] = useState(false);
    const [isExpedienteFilterPanelPinned, setIsExpedienteFilterPanelPinned] = useState(() => {
        return localStorage.getItem(DASHBOARD_FILTERS_PINNED_KEY) === 'true';
    });
    const [expedienteFilters, setExpedienteFilters] = useState<ExpedienteFilters>({});
    const dashboardColumnOptions: ColumnSelectorOption[] = [
        { id: 'identifier', label: 'Identificador' },
        { id: 'client', label: 'Cliente' },
        { id: 'totalAmount', label: 'Saldo' },
        { id: 'createdAt', label: 'Apertura' },
        { id: 'closedAt', label: 'Cierre' },
        { id: 'notes', label: 'Observaciones' },
        { id: 'quick_view', label: 'Vista rápida' },
        { id: 'responsible', label: 'Responsable' }
    ];
    const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem(DASHBOARD_VISIBLE_COLUMNS_KEY);
            if (!raw) return dashboardColumnOptions.map(c => c.id);
            const parsed = JSON.parse(raw) as string[];
            const allowed = new Set(dashboardColumnOptions.map(c => c.id));
            const filtered = parsed.filter(id => allowed.has(id));
            return filtered.length > 0 ? filtered : dashboardColumnOptions.map(c => c.id);
        } catch {
            return dashboardColumnOptions.map(c => c.id);
        }
    });

    // Collapsible search bar state
    const [isSearchExpanded, setIsSearchExpanded] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const suggestionsRef = useRef<HTMLDivElement>(null);
    const recentsRef = useRef<HTMLDivElement>(null);
    const skipOpenSuggestionsOnNextFocusRef = useRef(false);
    const [recentIdentifiers, setRecentIdentifiers] = useState<RecentClientIdentifierEntry[]>([]);
    const [isRecentsOpen, setIsRecentsOpen] = useState(false);
    const [isIdentifierPinned, setIsIdentifierPinned] = useState(false);
    const [pinnedIdentifier, setPinnedIdentifier] = useState<string | null>(null);
    const [isClientNavigationActive, setIsClientNavigationActive] = useState(false);
    const [clientNavigationTab, setClientNavigationTab] = useState<ClientNavigationTab>('expedientes');
    const visibleColumnsSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);

    useEffect(() => {
        localStorage.setItem(DASHBOARD_VISIBLE_COLUMNS_KEY, JSON.stringify(visibleColumns));
    }, [visibleColumns]);

    const emitHelpAction = useCallback((action: string, durationMs?: number) => {
        window.dispatchEvent(new CustomEvent('aga:help-action', { detail: { action, durationMs } }));
    }, []);

    const emitHelpError = useCallback((error: string) => {
        window.dispatchEvent(new CustomEvent('aga:help-error', { detail: { error } }));
    }, []);

    const toggleVisibleColumn = (id: string) => {
        setVisibleColumns(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
    };

    useEffect(() => {
        const context = consumeDashboardReturnContext();
        if (!context) return;

        setSelectedClientId(context.clientId || null);
        setSelectedClientLabel(context.clientLabel || '');
        setSearchQuery(context.searchQuery || context.identifier || '');
        setIdentifierFilter(context.identifierFilter || '');
        setPrefixFilter(context.prefixFilter || '');
        setResponsibleFilter(context.responsibleFilter || '');
        setResponsibleLabel(context.responsibleLabel || '');
        setStatusFilter(context.statusFilter || 'Todos');
        setCategoryFilter(context.categoryFilter || 'Todos');
        setSituationFilter(context.situationFilter || 'Todos');
        setDateFilterType(context.dateFilterType || 'createdAt');
        setStartDate(context.startDate || '');
        setEndDate(context.endDate || '');
        setSortConfig(context.sortConfig ?? null);
        setCurrentPage(context.currentPage && context.currentPage > 0 ? context.currentPage : 1);
        setPageSize(context.pageSize || 25);
        setExpedienteFilters(context.expedienteFilters || {});
        setIsExpedienteFilterPanelOpen(!!context.isExpedienteFilterPanelOpen);
        setIsSearchExpanded(context.isSearchExpanded ?? true);
    }, []);

    useEffect(() => {
        const hashCtx = extractClientNavigationFromHash();
        const storedCtx = readClientNavigationContext();
        const shouldActivate = hashCtx.enabled || storedCtx?.active;
        if (!shouldActivate) return;

        const clientId = hashCtx.clientId || storedCtx?.clientId || undefined;
        const clientName = hashCtx.clientName || storedCtx?.clientName || '';
        const identifier = hashCtx.identifier || storedCtx?.identifier || '';

        if (clientId) setSelectedClientId(clientId);
        if (clientName) setSelectedClientLabel(clientName);
        if (identifier && !searchQuery) setSearchQuery(identifier);
        setIsClientNavigationActive(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const selectedClientDocument = useMemo(() => {
        if (!selectedClientId) return '';
        const selectedClient = savedClients.find(c => c.id === selectedClientId);
        return (selectedClient?.documento || selectedClient?.nif || '').trim();
    }, [selectedClientId, savedClients]);

    useEffect(() => {
        if (!selectedClientId) return;
        const selectedClient = savedClients.find(c => c.id === selectedClientId);
        if (!selectedClient) return;

        const canonicalDocument = (selectedClient.documento || selectedClient.nif || '').trim();
        const canonicalName = (selectedClient.nombre || selectedClient.legalName || '').trim();

        if (canonicalName && canonicalName !== selectedClientLabel) {
            setSelectedClientLabel(canonicalName);
        }

        if (canonicalDocument) {
            const currentNormalized = normalizeIdentifier(searchQuery);
            const canonicalNormalized = normalizeIdentifier(canonicalDocument);
            if (currentNormalized !== canonicalNormalized) {
                setSearchQuery(canonicalDocument);
            }
        }
    }, [selectedClientId, savedClients, selectedClientLabel, searchQuery]);

    const selectedClientForNavigation = useMemo(() => {
        const docFromSearch = (searchQuery || identifierFilter || '').trim();
        const selectedById = selectedClientId ? savedClients.find(c => c.id === selectedClientId) : null;
        if (selectedById) {
            return {
                clientId: selectedById.id,
                clientName: selectedById.nombre || selectedById.legalName || selectedClientLabel || '',
                clientDocument: (selectedById.documento || selectedById.nif || docFromSearch || '').trim(),
                clientCity: selectedById.poblacion || '',
                clientProvince: selectedById.provincia || '',
                clientStatus: selectedById.estado || 'ACTIVO'
            };
        }

        const normalizedSearchDoc = normalizeIdentifier(docFromSearch);
        const selectedByDoc = normalizedSearchDoc
            ? savedClients.find(c => normalizeIdentifier(c.documento || c.nif || '') === normalizedSearchDoc)
            : null;

        return {
            clientId: selectedByDoc?.id || null,
            clientName: selectedByDoc?.nombre || selectedByDoc?.legalName || selectedClientLabel || '',
            clientDocument: (selectedByDoc?.documento || selectedByDoc?.nif || docFromSearch || '').trim(),
            clientCity: selectedByDoc?.poblacion || '',
            clientProvince: selectedByDoc?.provincia || '',
            clientStatus: selectedByDoc?.estado || 'ACTIVO'
        };
    }, [selectedClientId, selectedClientLabel, savedClients, searchQuery, identifierFilter]);

    useEffect(() => {
        if (!isClientNavigationActive) return;
        if (!selectedClientForNavigation.clientId && !selectedClientForNavigation.clientDocument) return;
        saveClientNavigationContext({
            active: true,
            clientId: selectedClientForNavigation.clientId,
            identifier: selectedClientForNavigation.clientDocument,
            clientName: selectedClientForNavigation.clientName,
            sourceModule: 'dashboard'
        });
    }, [isClientNavigationActive, selectedClientForNavigation]);

    const suggestions = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (q.length < 2) return [];

        const matches = new Map<string, SearchSuggestion>();

        // Optimized check: unique by document mostly
        savedClients.forEach(c => {
            const name = c.nombre || `${c.firstName || ''} ${c.surnames || ''}`.trim();
            const doc = String(c.documento || c.nif || '');

            if (String(name).toLowerCase().includes(q)) {
                matches.set(`name-${doc}`, { label: name, document: doc, type: 'name', clientId: c.id ?? undefined });
            }
            if (doc.toLowerCase().includes(q)) {
                matches.set(`doc-${doc}`, { label: name, document: doc, type: 'doc', clientId: c.id ?? undefined });
            }
        });

        caseHistory.forEach(c => {
            const name = c.clientSnapshot?.nombre || `${c.client.firstName || ''} ${c.client.surnames || ''}`.trim();
            const doc = String(c.clientSnapshot?.documento || c.client.nif || '');

            if (String(name).toLowerCase().includes(q)) {
                matches.set(`name-${doc}`, { label: name, document: doc, type: 'name', clientId: c.clienteId ?? undefined });
            }
            if (doc.toLowerCase().includes(q)) {
                matches.set(`doc-${doc}`, { label: name, document: doc, type: 'doc', clientId: c.clienteId ?? undefined });
            }
        });

        // Limit to 8 most relevant
        return Array.from(matches.values()).slice(0, 8);
    }, [searchQuery, savedClients, caseHistory]);

    const clientsByIdentifier = useMemo(() => {
        const map = new Map<string, string>();
        savedClients.forEach(client => {
            const key = normalizeIdentifier(client.documento || client.nif || '');
            if (!key) return;
            const fullName = (client.nombre || client.legalName || `${client.firstName || ''} ${client.surnames || ''}`).trim();
            if (fullName) map.set(key, fullName);
        });
        return map;
    }, [savedClients]);

    const resolvedSelectedClientName = useMemo(() => {
        if (selectedClientLabel.trim()) return selectedClientLabel;

        const q = searchQuery.trim().toLowerCase();
        if (!q) return '';

        const exactMatches = suggestions.filter(s =>
            String(s.document || '').toLowerCase() === q || String(s.label || '').toLowerCase() === q
        );

        if (exactMatches.length === 1) return exactMatches[0].label;
        return '';
    }, [searchQuery, selectedClientLabel, suggestions]);

    const hasExpedienteCriteria = useMemo(() => {
        const hasSelectedIdentifier = !!selectedClientId || searchQuery.trim().length > 0 || identifierFilter.trim().length > 0;
        const hasLegacyFilters =
            prefixFilter.trim().length > 0 ||
            responsibleFilter.trim().length > 0 ||
            statusFilter !== 'Todos' ||
            categoryFilter !== 'Todos' ||
            situationFilter !== 'Todos' ||
            startDate.trim().length > 0 ||
            endDate.trim().length > 0;

        const hasAdvancedFilters = Object.values(expedienteFilters).some(value => {
            if (value === undefined || value === null) return false;
            if (typeof value === 'string') return value.trim().length > 0;
            return true;
        });

        return hasSelectedIdentifier || hasLegacyFilters || hasAdvancedFilters;
    }, [
        selectedClientId,
        searchQuery,
        identifierFilter,
        prefixFilter,
        responsibleFilter,
        statusFilter,
        categoryFilter,
        situationFilter,
        startDate,
        endDate,
        expedienteFilters
    ]);

    useEffect(() => {
        const loadCasesOnDemand = async () => {
            if (!hasExpedienteCriteria || caseHistory.length > 0 || isDeferredCasesLoading) return;
            setIsDeferredCasesLoading(true);
            try {
                const firestore = await import('@/services/firestoreService');
                const cases = await firestore.getCaseHistory();
                updateCaseHistory(cases);
            } catch (error) {
                console.error('Error loading cases on demand:', error);
                addToast('No se pudieron cargar los expedientes para aplicar los filtros.', 'error');
            } finally {
                setIsDeferredCasesLoading(false);
            }
        };

        loadCasesOnDemand();
    }, [hasExpedienteCriteria, caseHistory.length, isDeferredCasesLoading, updateCaseHistory, addToast]);

    useEffect(() => {
        if (!hasExpedienteCriteria) {
            setCaseToPrint(null);
        }
    }, [hasExpedienteCriteria]);

    const getDisplayNameForIdentifier = useCallback((identifier: string) => {
        const normalized = normalizeRecentClientIdentifier(identifier);
        if (!normalized) return '';
        const match = savedClients.find(client =>
            normalizeRecentClientIdentifier(client.documento) === normalized ||
            normalizeRecentClientIdentifier(client.nif) === normalized
        );
        return match?.nombre || match?.legalName || '';
    }, [savedClients]);

    useEffect(() => {
        const loaded = readRecentClientIdentifiers(currentUser?.id);
        setRecentIdentifiers(loaded.map(entry => ({
            identifier: entry.identifier,
            displayName: entry.displayName || getDisplayNameForIdentifier(entry.identifier)
        })));
    }, [currentUser?.id, getDisplayNameForIdentifier]);

    useEffect(() => {
        if (searchQuery.trim() || selectedClientId) return;
        const active = readEffectiveClientIdentifier();
        if (active) setSearchQuery(active);
    }, [searchQuery, selectedClientId]);

    useEffect(() => {
        const refreshIdentifierContext = () => {
            const pinned = readIsIdentifierPinned();
            const pinnedValue = readPinnedIdentifier();
            const effective = readEffectiveClientIdentifier();
            setIsIdentifierPinned(pinned);
            setPinnedIdentifier(pinnedValue);
            if (pinned && pinnedValue) {
                setSearchQuery(pinnedValue);
                setShowSuggestions(false);
                setIsRecentsOpen(false);
            } else if (!searchQuery && effective) {
                setSearchQuery(effective);
            }
        };

        refreshIdentifierContext();
        window.addEventListener(getIdentifierContextChangedEventName(), refreshIdentifierContext as EventListener);
        return () => window.removeEventListener(getIdentifierContextChangedEventName(), refreshIdentifierContext as EventListener);
    }, [searchQuery]);


    // Filter Logic
    useEffect(() => {
        const applyFilterFromUrl = () => {
            const params = new URLSearchParams(window.location.hash.split('?')[1]);
            const clientIdFromUrl = params.get('clientId');
            const identifierFromUrl = params.get('identifier');
            const clientNameFromUrl = params.get('clientName');

            if (identifierFromUrl) {
                setSearchQuery(identifierFromUrl);
            }
            if (clientNameFromUrl) {
                setSelectedClientLabel(clientNameFromUrl);
            }

            if (clientIdFromUrl && !selectedClientId) {
                import('@/services/clientService').then(({ getClientById }) => {
                    getClientById(clientIdFromUrl).then((client) => {
                        if (client) {
                            setSelectedClientId(client.id);
                            setSelectedClientLabel(`${client.nombre}`);
                            if (!identifierFromUrl) {
                                setSearchQuery(client.documento || client.nif || '');
                            }
                        }
                    }).finally(() => {
                        setTimeout(() => {
                            const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
                            const keepClientNavigation = params.get('clientNav') === '1';
                            if (!keepClientNavigation && window.location.hash.includes('clientId=')) {
                                window.location.hash = '/';
                            }
                        }, 100);
                    });
                });
            }
        };
        applyFilterFromUrl();
        window.addEventListener('hashchange', applyFilterFromUrl);
        return () => window.removeEventListener('hashchange', applyFilterFromUrl);
    }, [selectedClientId]);

    const processedCases = useMemo(() => {
        if (!hasExpedienteCriteria) return [];
        if (!caseHistory) return [];
        const filtered = caseHistory.filter(c => {
            if (c.status === 'Eliminado') return false;

            // 1. Legacy Filters (Keep for compatibility until fully migrated)
            if (selectedClientId) {
                const caseDocument = normalizeIdentifier(c.clientSnapshot?.documento || c.client.nif || '');
                const normalizedSelectedDocument = normalizeIdentifier(selectedClientDocument);
                const matchesSameClient = c.clienteId === selectedClientId;
                const matchesSameIdentifier = normalizedSelectedDocument !== '' && caseDocument === normalizedSelectedDocument;

                if (!matchesSameClient && !matchesSameIdentifier) return false;
            }

            const matchesSearchQuery = !searchQuery || (() => {
                const normalizedQuery = searchQuery.toLowerCase();
                const normalizedQueryId = normalizeIdentifier(searchQuery);
                const clientName = (c.clientSnapshot?.nombre || `${c.client.firstName} ${c.client.surnames}`).toLowerCase();
                const snapshotDocument = (c.clientSnapshot?.documento || '').toLowerCase();
                const currentDocument = (c.client.nif || '').toLowerCase();
                const normalizedCaseIdentifier = normalizeIdentifier(c.clientSnapshot?.documento || c.client.nif || '');

                return clientName.includes(normalizedQuery) ||
                    (c.fileNumber || '').toLowerCase().includes(normalizedQuery) ||
                    snapshotDocument.includes(normalizedQuery) ||
                    currentDocument.includes(normalizedQuery) ||
                    (normalizedQueryId !== '' && normalizedCaseIdentifier.includes(normalizedQueryId));
            })();
            if (!matchesSearchQuery) return false;

            // 2. New ExpedienteFilters Logic
            if (expedienteFilters.numeroExpediente && !(c.fileNumber || '').toLowerCase().includes(expedienteFilters.numeroExpediente.toLowerCase())) return false;
            if (expedienteFilters.prefijoId && c.fileNumber?.split('-')[0] !== prefixes.find(p => p.id === expedienteFilters.prefijoId)?.code) return false;
            if (expedienteFilters.clienteTexto) {
                const q = expedienteFilters.clienteTexto.toLowerCase();
                const clientName = (c.clientSnapshot?.nombre || `${c.client.firstName} ${c.client.surnames}`).toLowerCase();
                const matches = clientName.includes(q) || (c.clientSnapshot?.documento || '').toLowerCase().includes(q);
                if (!matches) return false;
            }
            if (expedienteFilters.identificadorDesde || expedienteFilters.identificadorHasta) {
                const doc = (c.clientSnapshot?.documento || '').replace(/\D/g, '');
                const docNum = parseInt(doc, 10);
                if (!isNaN(docNum)) {
                    if (expedienteFilters.identificadorDesde && docNum < parseInt(expedienteFilters.identificadorDesde, 10)) return false;
                    if (expedienteFilters.identificadorHasta && docNum > parseInt(expedienteFilters.identificadorHasta, 10)) return false;
                }
            }

            // Situación y Estado
            const situacion = expedienteFilters.situacion || situationFilter;
            if (situacion !== 'Todos' && situacion !== '') {
                const s = c.situation || 'Iniciado';
                if (situacion === 'Abierto' && c.status === 'Cerrado') return false;
                if (situacion === 'Cerrado' && c.status !== 'Cerrado') return false;
                if (situacion !== 'Abierto' && situacion !== 'Cerrado' && s !== situacion) return false;
            }

            const estado = expedienteFilters.estado || (statusFilter !== 'Todos' ? statusFilter : undefined);
            if (estado && c.status !== estado) return false;

            const responsable = expedienteFilters.responsable || responsibleFilter;
            if (responsable && c.fileConfig?.responsibleUserId !== responsable) return false;

            // Fechas
            const tipoFecha = expedienteFilters.tipoFecha || (dateFilterType === 'createdAt' ? 'apertura' : 'cierre');
            const fechaD = expedienteFilters.fechaDesde || startDate;
            const fechaH = expedienteFilters.fechaHasta || endDate;

            if (fechaD || fechaH) {
                const key = tipoFecha === 'apertura' ? 'createdAt' :
                    tipoFecha === 'cierre' ? 'closedAt' :
                        tipoFecha === 'actualizacion' ? 'updatedAt' : 'createdAt';

                const dateToCheck = c[key as keyof CaseRecord] ? new Date(c[key as keyof CaseRecord] as string) : null;
                if (!dateToCheck) return false;

                if (fechaD && dateToCheck < new Date(fechaD)) return false;
                if (fechaH) {
                    const end = new Date(fechaH);
                    end.setHours(23, 59, 59, 999);
                    if (dateToCheck > end) return false;
                }
            }

            // Económico
            const caseBalance = getCaseBalance(c);
            if (expedienteFilters.saldoDesde !== undefined && caseBalance < expedienteFilters.saldoDesde) return false;
            if (expedienteFilters.saldoHasta !== undefined && caseBalance > expedienteFilters.saldoHasta) return false;
            if (expedienteFilters.saldoNoZero && caseBalance === 0) return false;
            if (expedienteFilters.saldoPositivo && caseBalance <= 0) return false;
            if (expedienteFilters.saldoNegativo && caseBalance >= 0) return false;

            // Texto libre
            if (expedienteFilters.textoObservaciones) {
                const q = expedienteFilters.textoObservaciones.toLowerCase();
                const obs = (c.description || (c as any).observations || '').toLowerCase();
                if (!obs.includes(q)) return false;
            }

            return true;
        });

        if (sortConfig) {
            filtered.sort((a, b) => {
                let aValue: any;
                let bValue: any;

                switch (sortConfig.key) {
                    case 'fileNumber': {
                        const [aPref, aNum] = a.fileNumber.split('-');
                        const [bPref, bNum] = b.fileNumber.split('-');
                        if (aPref !== bPref) {
                            aValue = aPref;
                            bValue = bPref;
                        } else {
                            aValue = parseInt(aNum, 10) || 0;
                            bValue = parseInt(bNum, 10) || 0;
                        }
                        break;
                    }
                    case 'identifier': {
                        aValue = normalizeIdentifier(a.clientSnapshot?.documento || a.client.nif || '');
                        bValue = normalizeIdentifier(b.clientSnapshot?.documento || b.client.nif || '');
                        break;
                    }
                    case 'client': {
                        aValue = getFullClientName(a, clientsByIdentifier);
                        bValue = getFullClientName(b, clientsByIdentifier);
                        break;
                    }
                    case 'responsible':
                        aValue = users.find(u => u.id === a.fileConfig?.responsibleUserId)?.name || '';
                        bValue = users.find(u => u.id === b.fileConfig?.responsibleUserId)?.name || '';
                        break;
                    case 'createdAt':
                    case 'closedAt':
                        aValue = a[sortConfig.key] ? new Date(a[sortConfig.key]!).getTime() : 0;
                        bValue = b[sortConfig.key] ? new Date(b[sortConfig.key]!).getTime() : 0;
                        break;
                    case 'totalAmount':
                        aValue = getCaseBalance(a);
                        bValue = getCaseBalance(b);
                        break;
                    case 'notes':
                        aValue = (a.description || (a as any).observations || (a as any).notes || '').toString();
                        bValue = (b.description || (b as any).observations || (b as any).notes || '').toString();
                        break;
                    default:
                        aValue = (a as any)[sortConfig.key] || '';
                        bValue = (b as any)[sortConfig.key] || '';
                }

                if (typeof aValue === 'string' || typeof bValue === 'string') {
                    const cmp = String(aValue).localeCompare(String(bValue), 'es', { sensitivity: 'base', numeric: true });
                    return sortConfig.direction === 'asc' ? cmp : -cmp;
                }

                const numA = Number(aValue) || 0;
                const numB = Number(bValue) || 0;
                if (numA < numB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (numA > numB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return filtered;
    }, [hasExpedienteCriteria, caseHistory, selectedClientId, selectedClientDocument, searchQuery, expedienteFilters, situationFilter, statusFilter, responsibleFilter, dateFilterType, startDate, endDate, sortConfig, users, prefixes, clientsByIdentifier]);

    const selectedTotalSaldo = useMemo(() => {
        if (selectedCases.length === 0) return 0;
        return processedCases
            .filter(c => selectedCases.includes(c.fileNumber))
            .reduce((sum, c) => sum + getCaseBalance(c), 0);
    }, [processedCases, selectedCases]);

    const activeFiltersText = useMemo(() => {
        const filters: string[] = [];
        if (selectedClientLabel) filters.push(`Cliente: ${selectedClientLabel}`);
        if (responsibleLabel) filters.push(`Responsable: ${responsibleLabel}`);
        if (startDate || endDate) {
            const label = dateFilterType === 'createdAt' ? 'Apertura' : 'Cierre';
            filters.push(`${label}: ${startDate || 'ini'} al ${endDate || 'fin'}`);
        }
        if (situationFilter !== 'Todos') filters.push(`Situación: ${situationFilter}`);
        if (statusFilter !== 'Todos') filters.push(`Estado: ${statusFilter}`);
        if (categoryFilter !== 'Todos') filters.push(`Cat: ${categoryFilter}`);
        if (prefixFilter) filters.push(`Prefijo: ${prefixFilter}`);
        if (identifierFilter) filters.push(`ID: ${identifierFilter}`);

        return filters.length > 0 ? filters.join(' | ') : null;
    }, [selectedClientLabel, responsibleLabel, startDate, endDate, dateFilterType, situationFilter, statusFilter, categoryFilter, prefixFilter, identifierFilter]);

    useEffect(() => {
        const load = async () => {
            try { const data = await getPrefixes(); setPrefixes(data); } catch (e) { console.error('Error loading prefixes', e); }
        };
        load();
    }, []);

    const handleSort = (key: string) => {
        setSortConfig(prev => {
            if (prev?.key === key) {
                if (prev.direction === 'asc') return { key, direction: 'desc' };
                return null;
            }
            return { key, direction: 'asc' };
        });
    };

    const handleClientNavigationTab = (tab: ClientNavigationTab) => {
        setClientNavigationTab(tab);
        saveClientNavigationContext({
            active: true,
            clientId: selectedClientForNavigation.clientId,
            identifier: selectedClientForNavigation.clientDocument,
            clientName: selectedClientForNavigation.clientName,
            sourceModule: 'dashboard'
        });

        const routeByTab: Record<ClientNavigationTab, string> = {
            expedientes: '/',
            albaranes: '/billing',
            facturas: '/invoices',
            economico: '/economico'
        };

        if (tab === 'expedientes') {
            setIsClientNavigationActive(false);
        }

        navigateToModule(buildPathWithClientNavigation(routeByTab[tab], {
            active: true,
            clientId: selectedClientForNavigation.clientId,
            identifier: selectedClientForNavigation.clientDocument,
            clientName: selectedClientForNavigation.clientName,
            sourceModule: 'dashboard'
        }));
    };

    const handleClearFilters = () => {
        setSearchQuery(''); setSelectedClientId(null); setSelectedClientLabel(''); setIdentifierFilter('');
        setPrefixFilter(''); setResponsibleFilter(''); setResponsibleLabel(''); setStatusFilter('Todos');
        setCategoryFilter('Todos'); setSituationFilter('Todos');
        setStartDate(''); setEndDate(''); setCurrentPage(1); setDateFilterType('createdAt');
    };

    // Calculate active expediente filter count
    const activeExpedienteFilterCount = useMemo(() => {
        let count = 0;
        if (expedienteFilters.numeroExpediente) count++;
        if (expedienteFilters.prefijoId) count++;
        if (expedienteFilters.clienteTexto) count++;
        if (expedienteFilters.identificadorDesde) count++;
        if (expedienteFilters.identificadorHasta) count++;
        if (expedienteFilters.situacion) count++;
        if (expedienteFilters.estado) count++;
        if (expedienteFilters.responsable) count++;
        if (expedienteFilters.fechaDesde || expedienteFilters.fechaHasta) count++;
        if (expedienteFilters.saldoDesde !== undefined || expedienteFilters.saldoHasta !== undefined) count++;
        if (expedienteFilters.saldoNoZero || expedienteFilters.saldoPositivo || expedienteFilters.saldoNegativo) count++;
        if (expedienteFilters.textoObservaciones) count++;
        return count;
    }, [expedienteFilters]);

    useEffect(() => {
        localStorage.setItem(DASHBOARD_FILTERS_PINNED_KEY, String(isExpedienteFilterPanelPinned));
    }, [isExpedienteFilterPanelPinned]);

    // ✅ Cerrar automáticamente el panel de filtros después de inactividad
    useEffect(() => {
        // Solo cerrar si el panel está abierto Y no hay filtros activos
        if (isExpedienteFilterPanelOpen && activeExpedienteFilterCount === 0 && !isExpedienteFilterPanelPinned) {
            // Esperar un margen amplio de inactividad antes de cerrar
            const timer = setTimeout(() => {
                setIsExpedienteFilterPanelOpen(false);
            }, FILTER_PANEL_AUTO_CLOSE_MS);

            return () => clearTimeout(timer);
        }
    }, [isExpedienteFilterPanelOpen, activeExpedienteFilterCount, isExpedienteFilterPanelPinned]);

    const handleClearExpedienteFilters = () => {
        setExpedienteFilters({});
        handleClearFilters();
        addToast("Filtros limpiados", "info");
    };

    // Search bar handlers
    const handleSearchExpand = () => {
        setIsSearchExpanded(true);
        setTimeout(() => searchInputRef.current?.focus(), 100);
    };

    const handleSearchClear = () => {
        setSearchQuery('');
        setIsSearchExpanded(false);
        setShowSuggestions(false);
        setIsRecentsOpen(false);
        setSelectedClientId(null);
        setSelectedClientLabel('');
        clearIdentifierContext();
    };

    const handleSelectSuggestion = (suggestion: SearchSuggestion) => {
        setSearchQuery(suggestion.type === 'name' ? suggestion.label : suggestion.document);
        setSelectedClientLabel(suggestion.label);
        setSelectedClientId(suggestion.clientId || null);
        setShowSuggestions(false);
        setIsRecentsOpen(false);
        skipOpenSuggestionsOnNextFocusRef.current = true;
        const updated = pushRecentClientIdentifier(currentUser?.id, suggestion.document, suggestion.label);
        setRecentIdentifiers(updated.map(entry => ({
            ...entry,
            displayName: entry.displayName || getDisplayNameForIdentifier(entry.identifier)
        })));
        if (isIdentifierPinned) {
            setPinnedClientIdentifier(currentUser?.id, suggestion.document, suggestion.label);
        } else {
            setActiveClientIdentifier(currentUser?.id, suggestion.document, suggestion.label);
        }
        setTimeout(() => searchInputRef.current?.focus(), 50);
    };

    const handleSelectRecentIdentifier = (identifier: string) => {
        const normalized = normalizeRecentClientIdentifier(identifier);
        if (!normalized) return;

        const clientMatch = savedClients.find(client =>
            normalizeRecentClientIdentifier(client.documento) === normalized ||
            normalizeRecentClientIdentifier(client.nif) === normalized
        );

        const name = clientMatch?.nombre || clientMatch?.legalName || getDisplayNameForIdentifier(identifier);
        const canonicalIdentifier = clientMatch?.documento || clientMatch?.nif || identifier;
        setSearchQuery(canonicalIdentifier);
        setSelectedClientLabel(name);
        setSelectedClientId(clientMatch?.id || null);
        setShowSuggestions(false);
        setIsRecentsOpen(false);
        const updated = pushRecentClientIdentifier(currentUser?.id, canonicalIdentifier, name);
        setRecentIdentifiers(updated.map(entry => ({
            ...entry,
            displayName: entry.displayName || getDisplayNameForIdentifier(entry.identifier)
        })));
        if (isIdentifierPinned) {
            setPinnedClientIdentifier(currentUser?.id, canonicalIdentifier, name);
        } else {
            setActiveClientIdentifier(currentUser?.id, canonicalIdentifier, name);
        }
        skipOpenSuggestionsOnNextFocusRef.current = true;
        setTimeout(() => searchInputRef.current?.focus(), 50);
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ctrl+K or Ctrl+F to open search
            if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')) {
                e.preventDefault();
                handleSearchExpand();
            }
            // Esc to close suggestions or search
            if (e.key === 'Escape') {
                if (showSuggestions) {
                    setShowSuggestions(false);
                } else if (isRecentsOpen) {
                    setIsRecentsOpen(false);
                } else if (!searchQuery) {
                    setIsSearchExpanded(false);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [searchQuery, showSuggestions, isRecentsOpen]);

    // Responsive search bar - auto-expand on large screens
    useEffect(() => {
        const handleResize = () => {
            const width = window.innerWidth;
            // Auto-expand on large screens (≥1200px)
            if (width >= 1200) {
                setIsSearchExpanded(true);
            }
            // Auto-collapse on small screens (<768px) if no search query
            else if (width < 768 && !searchQuery) {
                setIsSearchExpanded(false);
            }
        };

        // Set initial state
        handleResize();

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [searchQuery]);

    // Close menu on scroll or click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setOpenMenuId(null);
                setMenuPos(null);
            }
            if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
                setShowSuggestions(false);
            }
            if (recentsRef.current && !recentsRef.current.contains(e.target as Node)) {
                setIsRecentsOpen(false);
            }
        };

        const handleScroll = () => { setOpenMenuId(null); setMenuPos(null); };

        window.addEventListener('scroll', handleScroll, { capture: true });
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            window.removeEventListener('scroll', handleScroll, { capture: true });
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleSearchCollapse = () => {
        // Delay to allow clicking on suggestions
        setTimeout(() => {
            if (!searchQuery) {
                setIsSearchExpanded(false);
            }
        }, 300);
    };

    const stopResizing = useCallback(() => {
        _setIsResizing(false);
    }, []);

    const resize = useCallback((e: MouseEvent) => {
        if (_isResizing) {
            const newWidth = e.clientX;
            if (newWidth > 240 && newWidth < 600) {
                _setSidebarWidth(newWidth);
            }
        }
    }, [_isResizing]);

    useEffect(() => {
        window.addEventListener('mousemove', resize);
        window.addEventListener('mouseup', stopResizing);
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [resize, stopResizing]);

    const confirmBatchDelete = async () => {
        const casesToUpdate = caseHistory.filter(c => selectedCases.includes(c.fileNumber)).map(c => ({
            ...c,
            status: 'Eliminado' as CaseStatus,
            situation: 'Almacén',
            updatedAt: new Date().toISOString()
        }));
        await saveMultipleCases(casesToUpdate);
        setSelectedCases([]);
        setIsBatchDeleteModalOpen(false);
        addToast(`${casesToUpdate.length} expedientes movidos al Almacén correctamente`, 'warning');
    };

    const confirmBatchClose = async (options: { createAlbaran: boolean; createProforma: boolean }) => {
        const now = new Date();
        const casesToUpdate = caseHistory.filter(c => selectedCases.includes(c.fileNumber)).map(c => ({
            ...c, status: 'Cerrado' as CaseStatus, situation: 'Cerrado', closedAt: now.toISOString()
        }));

        try {
            // Build toast message based on selected options
            const actions: string[] = [];
            if (options.createAlbaran) actions.push('albaranes');
            if (options.createProforma) actions.push('proformas');
            const actionText = actions.length > 0 ? ` y generando ${actions.join(' y ')}` : '';

            addToast(`Cerrando expedientes${actionText}...`, 'info');
            console.log(`[Dashboard] Starting batch close for ${casesToUpdate.length} cases.`);
            console.log(`[Dashboard] Options: Albarán=${options.createAlbaran}, Proforma=${options.createProforma}`);

            // Execute in parallel but with individual error handling or logging
            await Promise.all(casesToUpdate.map(async (c) => {
                // Order: First Albarán, then Proforma

                // 1. Create Delivery Note (Albarán) if selected
                if (options.createAlbaran) {
                    console.log(`[Dashboard] Auto-creating delivery note for case: ${c.fileNumber}`);
                    try {
                        const success = await createDeliveryNoteFromCase({
                            client: c.client,
                            clientSnapshot: c.clientSnapshot,
                            fileNumber: c.fileNumber,
                            economicData: c.economicData
                        });
                        if (success) {
                            console.log(`[Dashboard] Delivery note created for ${c.fileNumber}`);
                        } else {
                            console.warn(`[Dashboard] Delivery note creation returned false for ${c.fileNumber} (likely duplicate or empty)`);
                        }
                    } catch (err) {
                        console.error(`[Dashboard] Failed to create delivery note for ${c.fileNumber}`, err);
                    }
                }

                // 2. Create Proforma if selected
                if (options.createProforma) {
                    console.log(`[Dashboard] Auto-creating proforma for case: ${c.fileNumber}`);
                    try {
                        const success = await createProformaFromCase({
                            client: c.client,
                            clientSnapshot: c.clientSnapshot,
                            fileNumber: c.fileNumber,
                            economicData: c.economicData
                        });
                        if (success) {
                            console.log(`[Dashboard] Proforma created for ${c.fileNumber}`);
                        } else {
                            console.warn(`[Dashboard] Proforma creation returned false for ${c.fileNumber} (likely duplicate or empty)`);
                        }
                    } catch (err) {
                        console.error(`[Dashboard] Failed to create proforma for ${c.fileNumber}`, err);
                    }
                }
            }));

            await saveMultipleCases(casesToUpdate);
            setSelectedCases([]);
            setIsBatchCloseModalOpen(false);
            addToast(`${casesToUpdate.length} expedientes cerrados correctamente`, 'success');
        } catch (error) {
            console.error('[Dashboard] Error in batch close:', error);
            addToast('Error al cerrar expedientes. Consulta la consola.', 'error');
        }
    };


    const handleCaseClick = (c: CaseRecord) => {
        handleToggleSelection(c.fileNumber);
    };

    const handleDuplicateSingleCase = async (caseRecord: CaseRecord) => {
        try {
            const newFileNumber = `${caseRecord.fileNumber}-DUP-${Date.now().toString().slice(-4)}`;
            const duplicatedCase: CaseRecord = {
                ...caseRecord,
                fileNumber: newFileNumber,
                status: 'Iniciado' as CaseStatus,
                situation: 'Iniciado',
                closedAt: undefined,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                attachments: [],
                tasks: [],
                communications: []
            };

            await saveMultipleCases([duplicatedCase]);
            addToast(`Expediente duplicado: ${newFileNumber}`, 'success');
        } catch (error) {
            console.error('[Dashboard] Error duplicando expediente', error);
            addToast('Error al duplicar expediente', 'error');
        }
    };

    const inferClientIdForNewCase = () => {
        if (selectedClientId) return selectedClientId;

        const normalizedQuery = normalizeIdentifier(searchQuery);
        if (!normalizedQuery) return undefined;

        const matchingClients = savedClients.filter(client => {
            const normalizedClientIdentifier = normalizeIdentifier(client.documento || client.nif || '');
            return normalizedClientIdentifier === normalizedQuery;
        });

        if (matchingClients.length === 1) {
            return matchingClients[0].id;
        }

        return undefined;
    };

    const buildBaseReturnContext = (): DashboardReturnContext => ({
        sourceView: 'dashboard',
        timestamp: Date.now(),
        searchQuery,
        identifierFilter,
        prefixFilter,
        responsibleFilter,
        responsibleLabel,
        statusFilter,
        categoryFilter,
        situationFilter,
        dateFilterType,
        startDate,
        endDate,
        currentPage,
        pageSize,
        sortConfig,
        expedienteFilters,
        isExpedienteFilterPanelOpen,
        isSearchExpanded
    });

    const persistReturnContextForNewCase = () => {
        const inferredClientId = inferClientIdForNewCase();

        const inferredClient = inferredClientId
            ? savedClients.find(c => c.id === inferredClientId)
            : undefined;

        const clientId = selectedClientId || inferredClientId || undefined;
        const clientLabel = selectedClientLabel || inferredClient?.nombre || undefined;
        const identifier = searchQuery || inferredClient?.documento || inferredClient?.nif || undefined;

        saveDashboardReturnContext({
            ...buildBaseReturnContext(),
            clientId,
            clientLabel,
            identifier
        });
    };

    const persistReturnContext = (caseRecord?: CaseRecord) => {
        const clientIdFromCase =
            caseRecord?.clienteId ||
            caseRecord?.client?.id ||
            undefined;
        const identifierFromCase =
            caseRecord?.clientSnapshot?.documento ||
            caseRecord?.client?.nif ||
            undefined;

        const fallbackLabel =
            caseRecord?.clientSnapshot?.nombre ||
            `${caseRecord?.client?.firstName || ''} ${caseRecord?.client?.surnames || ''}`.trim() ||
            undefined;

        saveDashboardReturnContext({
            ...buildBaseReturnContext(),
            clientId: selectedClientId || clientIdFromCase,
            clientLabel: selectedClientLabel || fallbackLabel,
            identifier: searchQuery || identifierFromCase
        });
    };

    const handleCaseDoubleClick = (c: CaseRecord) => {
        persistReturnContext(c);
        onSelectCase(c.fileNumber);
    };

    const handleToggleSelection = (id: string) => {
        setSelectedCases(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    // Final data to display
    const totalItems = processedCases.length;
    const isAll = pageSize === 'all';
    const totalPages = isAll ? 1 : Math.ceil(totalItems / (pageSize as number));

    const startIndex = isAll ? 0 : (currentPage - 1) * (pageSize as number);
    const endIndex = isAll ? totalItems : startIndex + (pageSize as number);
    const paginatedCases = processedCases.slice(startIndex, endIndex);

    useEffect(() => {
        if (hasExpedienteCriteria && !isDeferredCasesLoading && processedCases.length === 0) {
            emitHelpError('EMPTY_RESULT');
        }
    }, [hasExpedienteCriteria, isDeferredCasesLoading, processedCases.length, emitHelpError]);

    useEffect(() => {
        if (selectedCases.length > 1) {
            emitHelpAction('MULTI_SELECT');
        }
    }, [selectedCases.length, emitHelpAction]);

    const totalPagesValue = isAll ? 1 : Math.max(1, totalPages);

    // If current page is greater than total pages after filtering, reset to 1
    useEffect(() => {
        if (currentPage > totalPagesValue && totalPagesValue > 0) {
            setCurrentPage(1);
        }
    }, [totalPagesValue, currentPage]);

    return (
        <>
            <div className={`flex flex-1 overflow-hidden bg-white ${caseToPrint ? 'is-printing-single' : ''}`}>
                {/* New Expediente Filter Panel (LEFT SIDE, PUSH CONTENT) */}
                <ExpedienteFilterPanel
                    filters={expedienteFilters}
                    onFiltersChange={setExpedienteFilters}
                    onClose={() => setIsExpedienteFilterPanelOpen(false)}
                    isOpen={isExpedienteFilterPanelOpen}
                    isPinned={isExpedienteFilterPanelPinned}
                    onTogglePin={() => setIsExpedienteFilterPanelPinned(prev => !prev)}
                    prefixes={prefixes}
                    estados={Array.from(new Set([...(appSettings?.caseStatuses || []), 'Iniciado', 'Cerrado']))}
                    responsables={users.map(u => ({ id: u.id, name: u.name }))}
                />


                {/* Main Area */}
                <div className="flex-1 flex flex-col min-w-0 overflow-auto no-scrollbar print-area relative">
                    <div className="flex flex-col gap-6 p-10 print:hidden">
                        {/* Report Header for Print Selection (Visible only in print) */}
                        <div className="hidden print:block mb-8 border-b-2 border-slate-900 pb-4">
                            <div className="flex justify-between items-center">
                                <div>
                                    <h2 className="text-xl font-normal text-slate-900 uppercase">AGA Nexus</h2>
                                    <p className="text-[10px] text-slate-400 font-normal uppercase tracking-widest mt-1">
                                        Reporte de Expedientes Seleccionados ({selectedCases.length > 0 ? selectedCases.length : processedCases.length})
                                    </p>
                                </div>
                                <div className="text-right text-[10px] text-slate-400 font-normal leading-tight uppercase">
                                    <p>Generado el: {new Date().toLocaleDateString('es-ES')} a las {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</p>
                                    <p>Responsable: {currentUser?.name || 'Administrador'}</p>
                                </div>
                            </div>
                        </div>


                        {/* Header Action Area */}
                        <div className="flex flex-wrap items-center justify-between gap-3 no-print">
                            <div className="flex items-center gap-6">
                                <div className="app-tab app-tab-active cursor-default !py-1 !px-0 !h-auto">
                                    Expedientes
                                </div>

                                {/* Breadcrumbs */}
                                <Breadcrumbs
                                    items={[]}
                                    className="hidden lg:flex"
                                />

                                <BackToHubButton />

                                {/* Botón Volver a Clientes - Solo visible cuando se filtra por cliente */}
                                {selectedClientId && (
                                    <button
                                        onClick={() => {
                                            setSelectedClientId(null);
                                            setSelectedClientLabel('');
                                            navigateToModule('/clients');
                                        }}
                                        aria-label="Volver a Clientes"
                                        className="relative flex items-center justify-center w-11 h-11 bg-[#FAFAFA] border border-slate-200 rounded-2xl shadow-sm transition-all duration-300 hover:bg-[#EBF5FF] hover:border-[#B2D7FF] hover:-translate-x-1 active:scale-95 group"
                                        title="Volver al explorador de clientes"
                                    >
                                        <Undo2
                                            size={20}
                                            className="text-slate-600 group-hover:text-[#0071E3] transition-colors duration-300"
                                        />
                                        <span className="pointer-events-none absolute top-full mt-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-slate-800 text-white text-[9px] font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-300 shadow-xl z-50 whitespace-nowrap tracking-wider">
                                            VOLVER
                                            <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-800 rotate-45" />
                                        </span>
                                    </button>
                                )}

                                <PremiumFilterButton
                                    isActive={isExpedienteFilterPanelOpen}
                                    onClick={() => setIsExpedienteFilterPanelOpen(!isExpedienteFilterPanelOpen)}
                                    tooltip={`Filtrar expedientes${activeExpedienteFilterCount > 0 ? ` (${activeExpedienteFilterCount})` : ''}`}
                                />

                                <button
                                    onClick={() => {
                                        if (!selectedClientForNavigation.clientDocument && !selectedClientForNavigation.clientId) {
                                            addToast('Selecciona primero un cliente o identificador para activar la navegación por cliente', 'warning');
                                            return;
                                        }
                                        setIsClientNavigationActive(prev => {
                                            const next = !prev;
                                            if (next) {
                                                saveClientNavigationContext({
                                                    active: true,
                                                    clientId: selectedClientForNavigation.clientId,
                                                    identifier: selectedClientForNavigation.clientDocument,
                                                    clientName: selectedClientForNavigation.clientName,
                                                    sourceModule: 'dashboard'
                                                });
                                            } else {
                                                clearClientNavigationContext();
                                            }
                                            return next;
                                        });
                                        setClientNavigationTab('expedientes');
                                    }}
                                    aria-label="Navegación por cliente"
                                    className="relative flex items-center justify-center w-11 h-11 bg-white border border-slate-200 rounded-2xl shadow-sm transition-all duration-500 hover:bg-slate-50 hover:border-slate-300 hover:rotate-180 active:scale-90 group"
                                    title="Navegación por cliente"
                                >
                                    <Columns2
                                        size={20}
                                        strokeWidth={2}
                                        className={cn(
                                            "transition-colors duration-300",
                                            isClientNavigationActive ? "text-[#0071E3]" : "text-slate-600 group-hover:text-[#0071E3]"
                                        )}
                                    />
                                    <span className="pointer-events-none absolute top-full mt-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-slate-800 text-white text-[9px] font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shadow-xl z-50 whitespace-nowrap tracking-wider">
                                        VISTA DE NAVEGACIÓN
                                        <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-800 rotate-45" />
                                    </span>
                                </button>

                                <button
                                    onClick={() => {
                                        const initialClientId = inferClientIdForNewCase();
                                        persistReturnContextForNewCase();
                                        onCreateNewCase('GE-MAT', initialClientId);
                                    }}
                                    aria-label="Nuevo Expediente"
                                    className="relative flex items-center justify-center w-11 h-11 bg-blue-50/60 border border-blue-100 rounded-2xl shadow-sm transition-all duration-300 hover:bg-[#EBF5FF] hover:border-[#B2D7FF] hover:scale-110 active:scale-95 group"
                                    title="Crear nuevo expediente"
                                >
                                    <FolderPlus
                                        size={20}
                                        strokeWidth={2}
                                        className="text-[#0071E3] transition-colors duration-300"
                                    />
                                    <span className="pointer-events-none absolute top-full mt-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-slate-800 text-white text-[9px] font-bold rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shadow-xl z-50 whitespace-nowrap tracking-wider">
                                        Nuevo Expediente
                                        <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-800 rotate-45" />
                                    </span>
                                </button>

                                <ColumnSelectorMenu
                                    title="Columnas"
                                    iconOnly
                                    options={dashboardColumnOptions}
                                    visibleIds={visibleColumns}
                                    onToggle={toggleVisibleColumn}
                                />
                                <ColumnResizeToggle />

                                {/* Active filter chips */}
                                {activeExpedienteFilterCount > 0 && (
                                    <div className="flex items-center gap-2 px-3 py-1 bg-sky-50 border border-sky-100 rounded-full">
                                        <div className="size-1.5 rounded-full bg-sky-400" />
                                        <span className="text-[10px] font-normal uppercase tracking-widest text-sky-700">
                                            {activeExpedienteFilterCount} filtro{activeExpedienteFilterCount > 1 ? 's' : ''} activo{activeExpedienteFilterCount > 1 ? 's' : ''}
                                        </span>
                                        <button
                                            onClick={handleClearExpedienteFilters}
                                            className="text-sky-400 hover:text-sky-600 transition-colors ml-1"
                                            title="Limpiar filtros"
                                        >
                                            <X size={10} strokeWidth={3} />
                                        </button>
                                    </div>
                                )}

                            </div>
                        </div>


                        {/* NEW ACTION BAR with Collapsible Search */}
                        <div className="flex items-center justify-between bg-white border border-[#cfdbe7] rounded-xl px-4 py-3 shadow-sm mb-2 no-print gap-4">
                            {/* Left side - Collapsible Search Bar */}
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                {/* Search - Collapsible */}
                                <div className={`flex items-center gap-2 transition-all duration-300 ${isSearchExpanded ? 'flex-1' : 'flex-shrink-0'
                                    }`}>
                                    {!isSearchExpanded ? (
                                        // Collapsed state - Just icon button
                                        <button
                                            onClick={handleSearchExpand}
                                            className="flex items-center gap-2 px-3 py-2 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-all"
                                            title="Buscar (Ctrl+K)"
                                        >
                                            <Search className="w-4 h-4" />
                                            <span className="text-xs font-medium hidden lg:inline">Buscar</span>
                                        </button>
                                    ) : (
                                        // Expanded state - Full search input
                                        <div className="flex flex-1 min-w-0 items-center gap-2">
                                            <div className="relative min-w-0 flex-[1.2]">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                                <input
                                                    ref={searchInputRef}
                                                    type="text"
                                                    value={searchQuery}
                                                    onChange={(e) => {
                                                        if (isIdentifierPinned) return;
                                                        const nextValue = e.target.value;
                                                        setSearchQuery(nextValue);
                                                        setSelectedClientId(null);
                                                        setSelectedClientLabel('');
                                                        setShowSuggestions(true);
                                                        setIsRecentsOpen(false);
                                                        if (!nextValue.trim()) {
                                                            clearIdentifierContext();
                                                        }
                                                    }}
                                                    onFocus={() => {
                                                        if (skipOpenSuggestionsOnNextFocusRef.current) {
                                                            skipOpenSuggestionsOnNextFocusRef.current = false;
                                                            return;
                                                        }
                                                        setShowSuggestions(true);
                                                    }}
                                                    onBlur={handleSearchCollapse}
                                                    placeholder="Identificador (DNI/CIF)"
                                                    readOnly={isIdentifierPinned}
                                                    className={cn(
                                                        "w-full pl-10 py-2 border rounded-lg text-sm font-normal text-slate-700 shadow-sm outline-none transition-all placeholder:text-slate-400",
                                                        isIdentifierPinned
                                                            ? "pr-[220px] bg-sky-50 border-sky-200"
                                                            : "pr-[220px] bg-slate-50 border-slate-200 focus:bg-white focus:ring-2 focus:ring-sky-500/10 focus:border-sky-500"
                                                    )}
                                                />
                                                <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex items-center gap-2">
                                                    {searchQuery && (
                                                        <InputClearButton
                                                            onClick={handleSearchClear}
                                                            title="Limpiar búsqueda"
                                                        />
                                                    )}
                                                    <button
                                                        type="button"
                                                        onMouseDown={(e) => {
                                                            e.preventDefault();
                                                            if (isIdentifierPinned) {
                                                                unpinClientIdentifier();
                                                                return;
                                                            }
                                                            const candidate = normalizeRecentClientIdentifier(searchQuery || pinnedIdentifier || '');
                                                            if (!candidate) return;
                                                            setPinnedClientIdentifier(currentUser?.id, candidate, selectedClientLabel);
                                                        }}
                                                        className={cn(
                                                            "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
                                                            isIdentifierPinned
                                                                ? "border-sky-300 bg-sky-100 text-sky-700"
                                                                : "border-slate-200 bg-white text-slate-400 hover:text-sky-600 hover:border-sky-200"
                                                        )}
                                                        title={isIdentifierPinned ? "Identificador fijado (clic para desfijar)" : "Fijar identificador"}
                                                    >
                                                        <Pin className="w-3.5 h-3.5" />
                                                    </button>
                                                    <div ref={recentsRef} className="relative">
                                                    <button
                                                        type="button"
                                                        onMouseDown={(e) => {
                                                            e.preventDefault();
                                                            setIsRecentsOpen(v => !v);
                                                            setShowSuggestions(false);
                                                        }}
                                                        className="h-8 px-2.5 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 transition-colors"
                                                        title="Identificadores recientes de esta sesión"
                                                    >
                                                        <History className="w-3.5 h-3.5" />
                                                        <span className="text-[10px] font-semibold uppercase tracking-wider">Recientes</span>
                                                        <ChevronDown className={`w-3 h-3 transition-transform ${isRecentsOpen ? 'rotate-180' : ''}`} />
                                                    </button>

                                                    {isRecentsOpen && (
                                                        <div className="absolute z-[110] right-0 top-[calc(100%+8px)] w-72 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                                                            <div className="px-3 py-2 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50">
                                                                Ultimos identificadores
                                                            </div>
                                                            {recentIdentifiers.length === 0 ? (
                                                                <div className="px-3 py-3 text-xs text-slate-400">
                                                                    Sin identificadores en esta sesion.
                                                                </div>
                                                            ) : (
                                                                <div className="max-h-56 overflow-auto">
                                                                    {recentIdentifiers.map((recent) => (
                                                                        <button
                                                                            key={recent.identifier}
                                                                            type="button"
                                                                            onMouseDown={(e) => {
                                                                                e.preventDefault();
                                                                                handleSelectRecentIdentifier(recent.identifier);
                                                                            }}
                                                                            className="w-full text-left px-3 py-2 hover:bg-sky-50 border-b border-slate-50 last:border-0"
                                                                        >
                                                                            <div className="flex items-center gap-3">
                                                                                <span className="text-sm font-semibold text-slate-700">{recent.identifier}</span>
                                                                                <span className="text-xs text-slate-500 truncate ml-auto">{recent.displayName || '-'}</span>
                                                                            </div>
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    </div>
                                                </div>

                                                {/* Suggestions Panel */}
                                                {showSuggestions && suggestions.length > 0 && (
                                                    <div
                                                        ref={suggestionsRef}
                                                        className="absolute z-[100] top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300 ring-4 ring-black/5"
                                                    >
                                                        <div className="p-3 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
                                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Coincidencias encontradas</span>
                                                            <span className="text-[10px] font-bold text-sky-500 bg-sky-50 px-2 py-0.5 rounded-full uppercase">{suggestions.length} resultados</span>
                                                        </div>
                                                        <div className="max-h-80 overflow-y-auto no-scrollbar">
                                                            {suggestions.map((s, idx) => (
                                                                <button
                                                                    key={`${s.type}-${s.document}-${idx}`}
                                                                    onMouseDown={(e) => {
                                                                        e.preventDefault();
                                                                        handleSelectSuggestion(s);
                                                                    }}
                                                                    className="w-full text-left px-5 py-3.5 hover:bg-sky-50 transition-all border-b border-slate-50 last:border-0 group flex items-center justify-between"
                                                                >
                                                                    <div className="flex flex-col min-w-0">
                                                                        <span className={cn(
                                                                            "text-sm font-semibold transition-colors truncate",
                                                                            s.type === 'name' ? "text-slate-900 group-hover:text-sky-700" : "text-slate-600"
                                                                        )}>
                                                                            {s.label}
                                                                        </span>
                                                                        <div className="flex items-center gap-2 mt-1">
                                                                            <span className={cn(
                                                                                "text-[10px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter",
                                                                                s.type === 'doc' ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-500"
                                                                            )}>
                                                                                {s.document}
                                                                            </span>
                                                                            {s.type === 'name' && <span className="text-[10px] text-slate-300 font-bold uppercase italic">Titular</span>}
                                                                            {s.type === 'doc' && <span className="text-[10px] text-sky-400 font-bold uppercase italic">Identificador</span>}
                                                                        </div>
                                                                    </div>
                                                                    <div className="opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all">
                                                                        <div className="size-8 rounded-full bg-sky-500 flex items-center justify-center text-white shadow-lg shadow-sky-200">
                                                                            <ArrowUpRight size={16} strokeWidth={3} />
                                                                        </div>
                                                                    </div>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <input
                                                type="text"
                                                value={selectedClientForNavigation.clientName || resolvedSelectedClientName}
                                                readOnly
                                                placeholder="Nombre del identificador seleccionado"
                                                className="min-w-0 flex-1 py-2 px-3 border border-slate-200 rounded-lg text-sm font-normal text-slate-700 bg-slate-50 shadow-sm focus:outline-none"
                                                title={selectedClientForNavigation.clientName || resolvedSelectedClientName || 'Nombre del identificador seleccionado'}
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* Selection chip - Only show when items are selected */}
                                {selectedCases.length > 0 && (
                                    <div className="flex items-center gap-2 px-3 py-1.5 bg-sky-50 border border-sky-100 rounded-full shrink-0">
                                        <div className="size-5 rounded-full bg-sky-500 text-white flex items-center justify-center text-[10px] font-bold">
                                            {selectedCases.length}
                                        </div>
                                        <span className="text-[11px] font-medium text-sky-700 whitespace-nowrap">
                                            Seleccionado{selectedCases.length > 1 ? 's' : ''}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-1" />
                        </div>

                        {isClientNavigationActive && (
                            <div className="w-full bg-white rounded-[2.5rem] border border-slate-200/50 shadow-sm overflow-hidden">
                                <div className="px-12 pt-10 pb-8 flex justify-between items-start">
                                    <div className="space-y-2 min-w-0">
                                        <div className="flex items-center gap-4 flex-wrap">
                                            <h3 className="text-[22px] font-medium text-[#005FB8] tracking-tight capitalize truncate max-w-[900px]">
                                                {toUiTitleCase(selectedClientForNavigation.clientName || 'Cliente sin nombre')}
                                            </h3>
                                            <div className="flex items-center gap-2 px-2.5 py-1 bg-emerald-50/50 text-emerald-600 border border-emerald-100/50 rounded-full">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                <span className="text-[9px] font-bold uppercase tracking-wider">
                                                    {toUiTitleCase(selectedClientForNavigation.clientStatus || 'ACTIVO')}
                                                </span>
                                            </div>
                                        </div>
                                        <span className="inline-flex items-center gap-2 text-[11px] font-mono font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                                            <Hash className="w-3.5 h-3.5" />
                                            ID #{selectedClientForNavigation.clientDocument || '—'}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setIsClientNavigationActive(false);
                                            clearClientNavigationContext();
                                        }}
                                        className="p-3 text-slate-300 hover:text-[#0071E3] hover:bg-blue-50/50 rounded-2xl transition-all"
                                        title="Cerrar navegación por cliente"
                                    >
                                        <Edit3 size={18} />
                                    </button>
                                </div>

                                <div className="px-12 border-b border-slate-100/60">
                                    <div className="flex items-center gap-2 relative">
                                        {[
                                            { id: 'expedientes' as const, label: 'Expedientes', icon: FileText },
                                            { id: 'albaranes' as const, label: 'Albaranes', icon: Package },
                                            { id: 'facturas' as const, label: 'Facturas', icon: Receipt },
                                            { id: 'economico' as const, label: 'Económico', icon: BadgeEuro }
                                        ].map((tab) => {
                                            const Icon = tab.icon;
                                            const active = clientNavigationTab === tab.id;
                                            return (
                                                <button
                                                    key={tab.id}
                                                    onClick={() => handleClientNavigationTab(tab.id)}
                                                    className={cn(
                                                        "px-6 py-4 text-[11px] font-bold flex items-center gap-2.5 tracking-widest uppercase transition-colors relative",
                                                        active ? 'text-[#0071E3]' : 'text-slate-400 hover:text-slate-500'
                                                    )}
                                                >
                                                    <Icon size={14} strokeWidth={2.5} />
                                                    {tab.label}
                                                    <div
                                                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#0071E3] rounded-full transition-all duration-300 pointer-events-none"
                                                        style={{
                                                            opacity: active ? 1 : 0,
                                                            transform: active ? 'translateY(0)' : 'translateY(4px)'
                                                        }}
                                                    />
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="bg-[#e9f3fc] px-8 py-6 border-t border-[#d4e6f6]">
                                    <div className="flex items-center gap-3 text-[#2f73b7]">
                                        <Info className="w-5 h-5" />
                                        <p className="text-base">
                                            Seleccione una pestaña para navegar a la sección correspondiente del cliente.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Table View */}
                        {hasExpedienteCriteria && !isClientNavigationActive && (
                            <ResizableExplorerTable
                                data={paginatedCases}
                                columns={(baseColumns => {
                                    const actionIdx = baseColumns.findIndex((col: any) => col?.id === 'actions');
                                    if (actionIdx > 0) {
                                        const [actionsCol] = baseColumns.splice(actionIdx, 1);
                                        baseColumns.unshift(actionsCol);
                                    }
                                    return baseColumns;
                                })([
                                {
                                    id: 'select',
                                    label: '',
                                    minWidth: 40,
                                    defaultWidth: 44,
                                    align: 'center',
                                    sortable: false,
                                    render: (c: CaseRecord) => (
                                        <input
                                            type="checkbox"
                                            checked={selectedCases.includes(c.fileNumber)}
                                            onChange={() => handleToggleSelection(c.fileNumber)}
                                            className="h-4 w-4 rounded border-slate-200 border-2 bg-transparent text-[#4c739a] checked:bg-[#4c739a] checked:border-[#4c739a] focus:ring-0 focus:ring-offset-0 focus:border-slate-200 focus:outline-none"
                                        />
                                    )
                                },
                                {
                                    id: 'fileNumber',
                                    label: 'Expediente',
                                    minWidth: 100,
                                    defaultWidth: 120,
                                    render: (c: CaseRecord) => <span className="font-mono text-slate-700">{c.fileNumber}</span>
                                },
                                ...(visibleColumnsSet.has('identifier') ? [{
                                    id: 'identifier',
                                    label: 'Identificador',
                                    minWidth: 100,
                                    defaultWidth: 120,
                                    align: 'right' as const,
                                    render: (c: CaseRecord) => {
                                        const identifier = c.clientSnapshot?.documento || c.client.nif || '';
                                        return identifier ? (
                                            <CopyAction text={identifier}>
                                                <div className="inline-flex items-center gap-1 w-full justify-end group/copy">
                                                    <span className="text-slate-700 text-right">{identifier}</span>
                                                    <Copy size={12} className="text-slate-300 group-hover/copy:text-sky-500" />
                                                </div>
                                            </CopyAction>
                                        ) : (
                                            <span className="text-slate-700 w-full inline-block text-right">—</span>
                                        );
                                    }
                                }] : []),
                                ...(visibleColumnsSet.has('client') ? [{
                                    id: 'client',
                                    label: 'Cliente',
                                    minWidth: 150,
                                    defaultWidth: 320,
                                    truncate: false,
                                    render: (c: CaseRecord) => {
                                        const name = getFullClientName(c, clientsByIdentifier);
                                        return <span className="text-slate-700 whitespace-normal break-words" title={name}>{name}</span>;
                                    }
                                }] : []),
                                ...(visibleColumnsSet.has('totalAmount') ? [{
                                    id: 'totalAmount',
                                    label: 'Saldo',
                                    minWidth: 80,
                                    defaultWidth: 120,
                                    align: 'right' as const,
                                    render: (c: CaseRecord) => <span className="text-slate-700">{new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(getCaseBalance(c))}</span>
                                }] : []),
                                ...(visibleColumnsSet.has('createdAt') ? [{
                                    id: 'createdAt',
                                    label: 'Apertura',
                                    minWidth: 80,
                                    defaultWidth: 120,
                                    align: 'right' as const,
                                    render: (c: CaseRecord) => <span className="text-slate-500 text-[11px] uppercase tracking-tight w-full inline-block text-right">{c.createdAt ? new Date(c.createdAt).toLocaleDateString('es-ES') : '—'}</span>
                                }] : []),
                                ...(visibleColumnsSet.has('closedAt') ? [{
                                    id: 'closedAt',
                                    label: 'Cierre',
                                    minWidth: 80,
                                    defaultWidth: 120,
                                    align: 'center' as const,
                                    render: (c: CaseRecord) => <span className="text-slate-500 text-[11px] uppercase tracking-tight">{c.closedAt ? new Date(c.closedAt).toLocaleDateString('es-ES') : '—'}</span>
                                }] : []),
                                ...(visibleColumnsSet.has('notes') ? [{
                                    id: 'notes',
                                    label: 'Observaciones',
                                    minWidth: 150,
                                    defaultWidth: 280,
                                    render: (c: CaseRecord) => {
                                        const note = c.description || (c as any).observations || (c as any).notes || '—';
                                        return <span className="text-slate-500 italic" title={note}>{note}</span>;
                                    }
                                }] : []),
                                ...(visibleColumnsSet.has('quick_view') ? [{
                                    id: 'quick_view',
                                    label: '',
                                    minWidth: 40,
                                    defaultWidth: 56,
                                    align: 'center' as const,
                                    sortable: false,
                                    render: (c: CaseRecord) => (
                                        <div className="relative flex justify-center">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPreviewCase(c);
                                                }}
                                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all"
                                            >
                                                <Eye className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )
                                }] : []),
                                ...(visibleColumnsSet.has('responsible') ? [{
                                    id: 'responsible',
                                    label: 'Responsable',
                                    minWidth: 100,
                                    defaultWidth: 180,
                                    render: (c: CaseRecord) => {
                                        const userName = c.fileConfig?.responsibleUserId ? (users.find(u => u.id === c.fileConfig.responsibleUserId)?.name || c.fileConfig.responsibleUserId) : '—';
                                        return <span className="text-slate-700 text-[11px] uppercase" title={userName}>{userName}</span>;
                                    }
                                }] : []),
                                {
                                    id: 'actions',
                                    label: 'Acciones',
                                    minWidth: 40,
                                    defaultWidth: 60,
                                    align: 'center',
                                    sortable: false,
                                    render: (c: CaseRecord) => (
                                        <div className="relative flex items-center justify-center">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                    const MENU_WIDTH = 192; // w-48
                                                    const GAP = 8;
                                                    const leftCandidate = rect.left + window.scrollX - 150;
                                                    const rightAligned = rect.right + window.scrollX - MENU_WIDTH;
                                                    const minLeft = window.scrollX + GAP;
                                                    const maxLeft = window.scrollX + window.innerWidth - MENU_WIDTH - GAP;
                                                    const nextLeft = Math.min(
                                                        maxLeft,
                                                        Math.max(
                                                            minLeft,
                                                            rect.left < 220 ? rightAligned : leftCandidate
                                                        )
                                                    );
                                                    setOpenMenuId(openMenuId === c.fileNumber ? null : c.fileNumber);
                                                    setMenuPos({
                                                        top: rect.bottom + window.scrollY,
                                                        left: nextLeft
                                                    });
                                                }}
                                                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all"
                                                title="Acciones"
                                            >
                                                <MoreHorizontal className="w-4 h-4" />
                                            </button>

                                            {/* Context Menu */}
                                            {openMenuId === c.fileNumber && menuPos && (
                                                <div
                                                    ref={menuRef}
                                                    className="fixed bg-white rounded-xl shadow-2xl border border-slate-200 py-2 w-48 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200"
                                                    style={{
                                                        top: `${menuPos.top}px`,
                                                        left: `${menuPos.left}px`
                                                    }}
                                                >
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setPreviewCase(c); }}
                                                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center gap-3"
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                        Vista previa
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setOpenMenuId(null);
                                                            persistReturnContext(c);
                                                            onSelectCase(c.fileNumber);
                                                        }}
                                                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-sky-50 hover:text-sky-700 transition-colors flex items-center gap-3"
                                                    >
                                                        <Edit3 className="w-4 h-4" />
                                                        Editar
                                                    </button>
                                                    <button
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            setOpenMenuId(null);
                                                            await handleDuplicateSingleCase(c);
                                                        }}
                                                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition-colors flex items-center gap-3"
                                                    >
                                                        <Copy className="w-4 h-4" />
                                                        Duplicar expediente
                                                    </button>
                                                    <div className="my-1 border-t border-slate-100" />
                                                    <button
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            setOpenMenuId(null);
                                                            try {
                                                                await createDeliveryNoteFromCase({
                                                                    client: c.client,
                                                                    clientSnapshot: c.clientSnapshot,
                                                                    fileNumber: c.fileNumber,
                                                                    economicData: c.economicData
                                                                });
                                                                addToast('Albarán creado correctamente', 'success');
                                                            } catch (error) {
                                                                addToast('Error al crear albarán', 'error');
                                                                console.error(error);
                                                            }
                                                        }}
                                                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors flex items-center gap-3"
                                                    >
                                                        <FileText className="w-4 h-4" />
                                                        Crear Albarán
                                                    </button>
                                                    <button
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            setOpenMenuId(null);
                                                            try {
                                                                await createProformaFromCase({
                                                                    client: c.client,
                                                                    clientSnapshot: c.clientSnapshot,
                                                                    fileNumber: c.fileNumber,
                                                                    economicData: c.economicData
                                                                });
                                                                addToast('Proforma creada correctamente', 'success');
                                                            } catch (error) {
                                                                addToast('Error al crear proforma', 'error');
                                                                console.error(error);
                                                            }
                                                        }}
                                                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-sky-50 hover:text-sky-700 transition-colors flex items-center gap-3"
                                                    >
                                                        <Receipt className="w-4 h-4" />
                                                        Crear Proforma
                                                    </button>
                                                    <div className="my-1 border-t border-slate-100" />
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setCaseToPrint(c); setTimeout(() => { window.print(); setCaseToPrint(null); }, 100); }}
                                                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors flex items-center gap-3"
                                                    >
                                                        <Printer className="w-4 h-4" />
                                                        Imprimir
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); _setCaseToDelete(c.fileNumber); }}
                                                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 transition-colors flex items-center gap-3"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                        Eliminar
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )
                                }
                                ] as any) as any}
                                storageKey="case-table-col-widths"
                                rowIdKey="fileNumber"
                                selectedRowIds={selectedCases as any}
                                onRowClick={handleCaseClick}
                                onRowDoubleClick={handleCaseDoubleClick}
                                sortConfig={sortConfig as any}
                                onSort={handleSort as any}
                                allSelected={paginatedCases.length > 0 && paginatedCases.every(c => selectedCases.includes(c.fileNumber))}
                                onToggleSelectAll={() => {
                                    const ids = paginatedCases.map(c => c.fileNumber);
                                    setSelectedCases(prev => ids.every(id => prev.includes(id)) ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
                                }}
                            />
                        )}
                    </div>

                    {/* Empty State */}
                    {!hasExpedienteCriteria && (
                        <div className="flex flex-col items-center justify-center py-14 bg-slate-50 rounded-lg border border-dashed border-[#cfdbe7]">
                            <p className="text-[#4c739a] text-base font-normal">Explorador vacío por defecto. Selecciona un identificador o aplica filtros para buscar expedientes.</p>
                        </div>
                    )}

                    {hasExpedienteCriteria && paginatedCases.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-20 bg-slate-50 rounded-lg border border-dashed border-[#cfdbe7]">
                            {isDeferredCasesLoading ? (
                                <p className="text-[#4c739a] text-base font-normal">Cargando expedientes para aplicar los criterios...</p>
                            ) : (
                                <>
                                    <p className="text-[#4c739a] text-base font-normal">No se han encontrado expedientes que coincidan con los criterios.</p>
                                    <button onClick={handleClearFilters} className="mt-4 text-[#4c739a] font-normal text-sm hover:underline uppercase tracking-widest">Limpiar todos los filtros</button>
                                </>
                            )}
                        </div>
                    )}

                    {/* Pagination and View Options */}
                    {hasExpedienteCriteria && (
                        <PaginationControls
                            currentPage={currentPage}
                            totalPages={totalPagesValue}
                            pageSize={pageSize as PageSize}
                            totalItems={totalItems}
                            onPageChange={setCurrentPage}
                            onPageSizeChange={(size) => setPageSize(size as typeof pageSize)}
                            variant="default"
                        />
                    )}
                </div>
            </div >
            {/* Modals extracted to component to fix syntax/root errors */}
            < DashboardModals
                isBatchCloseModalOpen={isBatchCloseModalOpen}
                setIsBatchCloseModalOpen={setIsBatchCloseModalOpen}
                confirmBatchClose={confirmBatchClose}
                selectedCasesCount={selectedCases.length}
                isBatchDeleteModalOpen={isBatchDeleteModalOpen}
                setIsBatchDeleteModalOpen={setIsBatchDeleteModalOpen}
                confirmBatchDelete={confirmBatchDelete}
                deletePassword={appSettings?.deletePassword}
            />

            {previewCase && (
                <CasePreviewModal
                    isOpen={!!previewCase}
                    onClose={() => setPreviewCase(null)}
                    caseRecord={previewCase}
                />
            )}

            {/* 1. REPORT OF SELECTED CASES (Print Only) */}
            {
                !caseToPrint && (
                    <div id="print-root" className="hidden print:block bg-white p-[10mm] w-full min-h-screen">
                        {/* Professional Header */}
                        <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4 mb-8">
                            <div>
                                <h2 className="text-xl font-normal text-slate-900 uppercase tracking-widest">AGA Nexus</h2>
                                <p className="text-[10px] text-slate-400 font-normal uppercase tracking-widest mt-1">
                                    {selectedCases.length > 0 ? `Reporte de Selección (${selectedCases.length} registros)` : `Reporte de Consulta (${processedCases.length} registros)`}
                                </p>
                            </div>
                            <div className="bg-slate-900 text-white px-6 py-3 rounded-xl text-right">
                                <p className="text-[8px] font-normal uppercase opacity-70 mb-1 tracking-widest">Total Saldo Seleccionado</p>
                                <p className="text-2xl font-normal">
                                    {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(selectedCases.length > 0 ? selectedTotalSaldo : processedCases.reduce((s, c) => s + getCaseBalance(c), 0))}
                                </p>
                            </div>
                            <div className="text-right text-[10px] text-slate-400 font-normal leading-tight uppercase tracking-widest">
                                <p>Generado el: {new Date().toLocaleDateString('es-ES')} {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</p>
                                <p>Responsable: {currentUser?.name || 'Administrador'}</p>
                            </div>
                        </div>

                        {/* Active Filters Block */}
                        {activeFiltersText && (
                            <div className="mb-6 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                                <p className="text-[9px] font-normal text-slate-500 uppercase tracking-widest">
                                    <span className="text-slate-900 mr-2">Filtros Activos:</span>
                                    {activeFiltersText}
                                </p>
                            </div>
                        )}

                        {/* Report Table */}
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="bg-slate-100 border-y border-slate-900">
                                    <th className="px-2 py-3 text-left text-[10px] font-normal uppercase border-r border-slate-200 tracking-widest">Expediente</th>
                                    <th className="px-2 py-3 text-left text-[10px] font-normal uppercase border-r border-slate-200 tracking-widest">Identificador</th>
                                    <th className="px-2 py-3 text-left text-[10px] font-normal uppercase border-r border-slate-200 tracking-widest">Cliente</th>
                                    <th className="px-2 py-3 text-right text-[10px] font-normal uppercase border-r border-slate-200 tracking-widest">Saldo</th>
                                    <th className="px-2 py-3 text-left text-[10px] font-normal uppercase border-r border-slate-200 tracking-widest">F. Apertura</th>
                                    <th className="px-2 py-3 text-left text-[10px] font-normal uppercase border-r border-slate-200 tracking-widest">F. Cierre</th>
                                    <th className="px-2 py-3 text-left text-[10px] font-normal uppercase border-r border-slate-200 tracking-widest">Situación</th>
                                    <th className="px-2 py-3 text-left text-[10px] font-normal uppercase border-r border-slate-200 tracking-widest">Estado</th>
                                    <th className="px-2 py-3 text-left text-[10px] font-normal uppercase tracking-widest">Responsable</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(selectedCases.length > 0
                                    ? processedCases.filter(c => selectedCases.includes(c.fileNumber))
                                    : processedCases
                                ).map((c) => (
                                    <tr key={c.fileNumber} className="border-b border-slate-200">
                                        <td className="px-2 py-2 text-[10px] font-normal border-r border-slate-100 whitespace-nowrap">{c.fileNumber}</td>
                                        <td className="px-2 py-2 text-[10px] font-normal border-r border-slate-100">{c.clientSnapshot?.documento || c.client.nif || '—'}</td>
                                        <td className="px-2 py-2 text-[10px] font-normal border-r border-slate-100 truncate max-w-[150px]">{c.clientSnapshot?.nombre || `${c.client.firstName} ${c.client.surnames}`}</td>
                                        <td className="px-2 py-2 text-[10px] font-normal text-right border-r border-slate-100">{new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(getCaseBalance(c))}</td>
                                        <td className="px-2 py-2 text-[10px] font-normal border-r border-slate-100 text-center">{c.createdAt && !isNaN(new Date(c.createdAt).getTime()) ? new Date(c.createdAt).toLocaleDateString('es-ES') : '—'}</td>
                                        <td className="px-2 py-2 text-[10px] font-normal border-r border-slate-100 text-center">{c.closedAt && !isNaN(new Date(c.closedAt).getTime()) ? new Date(c.closedAt).toLocaleDateString('es-ES') : (c.status === 'Cerrado' ? '—' : 'VIGENTE')}</td>
                                        <td className="px-2 py-2 text-[10px] font-normal italic border-r border-slate-100">{c.situation || 'Iniciado'}</td>
                                        <td className="px-2 py-2 text-[10px] font-normal border-r border-slate-100">
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-normal uppercase border border-slate-200 bg-white tracking-widest">
                                                {c.status}
                                            </span>
                                        </td>
                                        <td className="px-2 py-2 text-[10px] font-normal uppercase text-slate-500 tracking-widest">
                                            {users.find(u => u.id === c.fileConfig?.responsibleUserId)?.name || '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {/* Footer */}
                        <div className="mt-8 flex justify-between items-center text-[9px] text-slate-400 font-normal uppercase tracking-widest">
                            <span>Documento Oficial generado por AGA Nexus</span>
                            <span>Auditoría de Control Administrativo</span>
                            <span>Página 1 de 1</span>
                        </div>
                    </div>
                )
            }

            {/* 2. SINGLE CASE LAYOUT (Existing Print Only) */}
            {
                caseToPrint && (
                    <div id="print-root" className="fixed inset-0 bg-white z-[100] p-10 print:block hidden overflow-y-auto">
                        {/* Header Institucional de Impresión */}
                        <div className="flex justify-between items-center border-b-2 border-slate-900 pb-4 mb-8">
                            <div>
                                <h2 className="text-xl font-black text-slate-900 uppercase tracking-tighter">AGA Nexus</h2>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Sistema de Gestión Administrativa • Reporte Oficial</p>
                            </div>
                            <div className="text-right text-[10px] text-slate-400 font-bold leading-tight">
                                <p>IMPRESO EL: {new Date().toLocaleDateString('es-ES')} A LAS {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</p>
                                <p>USUARIO: {currentUser?.name || 'Sistema'} ({currentUser?.role || 'user'})</p>
                            </div>
                        </div>

                        <div className="max-w-4xl mx-auto border border-slate-200 p-8 rounded-2xl shadow-sm bg-white">
                            <div className="flex justify-between items-start border-b border-slate-200 pb-6 mb-8">
                                <div>
                                    <h1 className="text-3xl font-black text-slate-900 mb-1">DETALLE DE EXPEDIENTE</h1>
                                    <p className="text-[#1380ec] font-black text-xl tracking-tighter">{caseToPrint.fileNumber}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-black text-slate-400 uppercase tracking-widest mb-1">SITUACIÓN</p>
                                    <span className="px-3 py-1 bg-slate-100 rounded-full text-slate-700 font-black text-sm uppercase">{caseToPrint.situation || 'INICIADO'}</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-10 mb-10">
                                {/* SECCIÓN CLIENTE */}
                                <div className="space-y-6">
                                    <section className="print-section">
                                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 border-l-4 border-[#1380ec] pl-3">Datos del Cliente</h3>
                                        <div className="space-y-2">
                                            <p className="text-sm border-b border-slate-50 pb-2 flex justify-between">
                                                <span className="font-bold text-slate-500 uppercase text-[10px]">Titular:</span>
                                                <span className="text-slate-900 font-black truncate max-w-[200px]">{caseToPrint.clientSnapshot?.nombre || `${caseToPrint.client.firstName} ${caseToPrint.client.surnames}`}</span>
                                            </p>
                                            <p className="text-sm border-b border-slate-50 pb-2 flex justify-between">
                                                <span className="font-bold text-slate-500 uppercase text-[10px]">NIF/CIF:</span>
                                                <span className="text-slate-900 font-black">{caseToPrint.clientSnapshot?.documento || caseToPrint.client.nif}</span>
                                            </p>
                                            <p className="text-sm flex justify-between">
                                                <span className="font-bold text-slate-500 uppercase text-[10px]">Contacto:</span>
                                                <span className="text-slate-900 font-black">{caseToPrint.client.email || '—'}</span>
                                            </p>
                                        </div>
                                    </section>

                                    {/* SECCIÓN ADMIN / FECHAS */}
                                    <section className="print-section">
                                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 border-l-4 border-slate-200 pl-3">Tiempos y Responsable</h3>
                                        <div className="space-y-2">
                                            <p className="text-sm border-b border-slate-50 pb-2 flex justify-between">
                                                <span className="font-bold text-slate-500 uppercase text-[10px]">Apertura:</span>
                                                <span className="text-slate-900 font-black">
                                                    {caseToPrint.createdAt && !isNaN(new Date(caseToPrint.createdAt).getTime())
                                                        ? new Date(caseToPrint.createdAt).toLocaleDateString('es-ES')
                                                        : '—'}
                                                </span>
                                            </p>
                                            <p className="text-sm border-b border-slate-50 pb-2 flex justify-between">
                                                <span className="font-bold text-slate-500 uppercase text-[10px]">Cierre:</span>
                                                <span className="text-slate-900 font-black">
                                                    {caseToPrint.closedAt
                                                        ? (!isNaN(new Date(caseToPrint.closedAt).getTime()) ? new Date(caseToPrint.closedAt).toLocaleDateString('es-ES') : '—')
                                                        : 'VIGENTE'}
                                                </span>
                                            </p>
                                            <p className="text-sm flex justify-between">
                                                <span className="font-bold text-slate-500 uppercase text-[10px]">Gestor:</span>
                                                <span className="text-slate-900 font-black uppercase text-xs">{users.find(u => u.id === caseToPrint.fileConfig.responsibleUserId)?.name || caseToPrint.fileConfig.responsibleUserId || '—'}</span>
                                            </p>
                                        </div>
                                    </section>
                                </div>

                                {/* SECCIÓN ESTADO Y SALDO */}
                                <div className="space-y-6">
                                    <section className="p-6 bg-slate-50 rounded-2xl border border-slate-100 print-section">
                                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Estado de Tramitación</h3>
                                        <div className="flex flex-col gap-3">
                                            <span className={`px-4 py-2 rounded-xl text-center text-sm font-black ring-4 ring-white shadow-sm ${caseToPrint.status.includes('Finalizado') ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                                                {caseToPrint.status.toUpperCase()}
                                            </span>
                                            <p className="text-[9px] text-center text-slate-400 font-black uppercase">
                                                Última Variación: {caseToPrint.updatedAt && !isNaN(new Date(caseToPrint.updatedAt).getTime())
                                                    ? new Date(caseToPrint.updatedAt).toLocaleString('es-ES')
                                                    : '—'}
                                            </p>
                                        </div>
                                    </section>

                                    {getCaseBalance(caseToPrint) >= 0 && (
                                        <section className="p-6 bg-slate-900 rounded-2xl text-white shadow-xl print-section">
                                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">BALANCE ECONÓMICO</h3>
                                            <p className="text-4xl font-black">{new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(getCaseBalance(caseToPrint))}</p>
                                            <div className="h-px bg-white/10 my-3" />
                                            <div className="flex justify-between text-[10px] text-slate-400 font-bold">
                                                <span>BASE IMPONIBLE:</span>
                                                <span className="text-white">{new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(caseToPrint.economicData.subtotalAmount)}</span>
                                            </div>
                                        </section>
                                    )}
                                </div>
                            </div>

                            {/* Bloque Legal / Sello */}
                            <div className="flex justify-between items-end mt-12 pt-8 border-t border-slate-100">
                                <div className="text-[9px] text-slate-400 font-bold max-w-sm">
                                    <p>Este documento es una representación digital de los datos almacenados en el AGA Nexus.</p>
                                    <p className="mt-1">Identificador Único de Proceso: {btoa(caseToPrint.fileNumber)}</p>
                                </div>
                                <div className="w-32 h-32 border-2 border-slate-100 rounded-lg flex flex-col items-center justify-center p-2 opacity-50">
                                    <p className="text-[8px] font-black text-slate-300 uppercase mb-2">Sello Control</p>
                                    <div className="w-16 h-16 bg-slate-50 rounded-md border border-slate-100" />
                                </div>
                            </div>

                            <div className="text-center text-[9px] text-slate-400 mt-8 font-black uppercase tracking-tighter">
                                DOCUMENTO GENERADO POR GESTOR DE EXPEDIENTES PRO • AUDITORÍA INTERNA
                            </div>
                        </div>
                    </div>
                )
            }
        </>
    );
};

export default Dashboard;
