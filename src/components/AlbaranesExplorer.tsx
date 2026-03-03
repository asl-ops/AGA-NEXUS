import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
    Search,
    Eye,
    FileText,
    Printer,
    Plus,
    X,
    ArrowUpDown,
    MoreHorizontal,
    History,
    ChevronDown,
    Copy,
    Pin
} from 'lucide-react';
import { DeliveryNote } from '../types/billing';
import { useBilling } from '../hooks/useBilling';
import { useToast } from '../hooks/useToast';
import { useAppContext } from '../contexts/AppContext';
import { BackToHubButton } from './ui/BackToHubButton';
import { BackToClientNavigationButton } from './ui/BackToClientNavigationButton';
import { ResizableExplorerTable } from './ui/ResizableExplorerTable';
import { Button } from './ui/Button';
import { cn } from '../utils/cn';
import Breadcrumbs from './ui/Breadcrumbs';
import { ColumnSelectorMenu, type ColumnSelectorOption } from './ui/ColumnSelectorMenu';
import { PremiumFilterButton } from './ui/PremiumFilterButton';
import { InputClearButton } from './ui/InputClearButton';
import { ColumnResizeToggle } from './ui/ColumnResizeToggle';
import { navigateToModule } from '@/utils/moduleNavigation';
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
import { CopyAction } from './ui/ActionFeedback';
import { getClientNavigationReturnPath, saveClientNavigationContext } from '@/utils/clientNavigationContext';

interface AlbaranesExplorerProps {
    onReturn: () => void;
}

const ALBARANES_VISIBLE_COLUMNS_KEY = 'albaranes-visible-columns-v1';

// Expediente preview popover component
const ExpedientePreviewPopover: React.FC<{
    expedienteNumero: string;
    onClose: () => void;
    position: { top: number; left: number };
}> = ({ expedienteNumero, onClose, position }) => {
    const { caseHistory, users } = useAppContext();
    const [isLoading, setIsLoading] = useState(true);
    const expediente = caseHistory.find(c => c.fileNumber === expedienteNumero);

    useEffect(() => {
        // Simulate loading
        setTimeout(() => setIsLoading(false), 300);
    }, []);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    const handleOpenExpediente = () => {
        window.location.hash = `#/detail/${expedienteNumero}`;
    };

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={onClose} />

            {/* Popover */}
            <div
                className="fixed z-50 w-[360px] bg-white rounded-2xl shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200"
                style={{
                    top: `${position.top}px`,
                    left: `${position.left}px`,
                }}
            >
                {isLoading ? (
                    <div className="p-6">
                        <div className="animate-pulse space-y-3">
                            <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                            <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                            <div className="h-20 bg-slate-200 rounded"></div>
                        </div>
                    </div>
                ) : expediente ? (
                    <>
                        {/* Header */}
                        <div className="p-4 border-b border-slate-100">
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <h3 className="text-base font-medium text-sky-700">{expediente.fileNumber}</h3>
                                    <p className="text-sm text-slate-600 mt-0.5">{expediente.clientSnapshot?.nombre || 'Sin cliente'}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 text-xs font-medium rounded-lg ${expediente.status === 'open' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                        expediente.status === 'closed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                            'bg-slate-100 text-slate-600 border border-slate-200'
                                        }`}>
                                        {expediente.status === 'open' ? 'Abierto' : expediente.status === 'closed' ? 'Cerrado' : expediente.status}
                                    </span>
                                    <button
                                        onClick={onClose}
                                        className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Info */}
                        <div className="p-4 space-y-4">
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <span className="text-xs font-medium text-slate-500 block mb-1">Identificador</span>
                                    {expediente.clientSnapshot?.documento ? (
                                        <CopyAction text={expediente.clientSnapshot.documento}>
                                            <div className="inline-flex items-center gap-1 group/copy">
                                                <span className="text-slate-700">{expediente.clientSnapshot.documento}</span>
                                                <Copy size={12} className="text-slate-300 group-hover/copy:text-sky-500" />
                                            </div>
                                        </CopyAction>
                                    ) : (
                                        <span className="text-slate-700">N/A</span>
                                    )}
                                </div>
                                <div>
                                    <span className="text-xs font-medium text-slate-500 block mb-1">Responsable</span>
                                    <span className="text-slate-700">
                                        {users.find(u => u.id === expediente.fileConfig?.responsibleUserId)?.name || 'Sin asignar'}
                                    </span>
                                </div>
                                <div>
                                    <span className="text-xs font-medium text-slate-500 block mb-1">Apertura</span>
                                    <span className="text-slate-700">
                                        {new Date(expediente.createdAt).toLocaleDateString('es-ES')}
                                    </span>
                                </div>
                                {expediente.closedAt && (
                                    <div>
                                        <span className="text-xs font-medium text-slate-500 block mb-1">Cierre</span>
                                        <span className="text-slate-700">
                                            {new Date(expediente.closedAt).toLocaleDateString('es-ES')}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Economic summary */}
                            <div className="pt-3 border-t border-slate-100">
                                <span className="text-xs font-medium text-slate-500 block mb-2">Resumen Económico</span>
                                <div className="space-y-1.5 text-xs">
                                    <div className="flex justify-between text-slate-600">
                                        <span>Honorarios</span>
                                        <span className="font-mono">0,00 €</span>
                                    </div>
                                    <div className="flex justify-between text-slate-600">
                                        <span>Suplidos</span>
                                        <span className="font-mono">0,00 €</span>
                                    </div>
                                    <div className="flex justify-between text-slate-600">
                                        <span>IVA</span>
                                        <span className="font-mono">0,00 €</span>
                                    </div>
                                    <div className="flex justify-between text-sky-700 font-medium pt-1 border-t border-slate-100">
                                        <span>Total</span>
                                        <span className="font-mono">
                                            {(expediente.economicData?.totalAmount || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Last activity */}
                            {expediente.communications && expediente.communications.length > 0 && (
                                <div className="pt-3 border-t border-slate-100">
                                    <span className="text-xs font-medium text-slate-500 block mb-1.5">Última actividad</span>
                                    <p className="text-xs text-slate-600 line-clamp-2">
                                        {expediente.communications[expediente.communications.length - 1].concept}
                                    </p>
                                    <span className="text-xs text-slate-400 mt-1 block">
                                        {new Date(expediente.communications[expediente.communications.length - 1].date).toLocaleDateString('es-ES')}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-slate-100">
                            <button
                                onClick={handleOpenExpediente}
                                className="w-full px-4 py-2 text-sm font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-xl transition-all"
                            >
                                Abrir expediente
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="p-6 text-center">
                        <p className="text-sm text-slate-500">Expediente no disponible</p>
                    </div>
                )}
            </div>
        </>
    );
};

const AlbaranesExplorer: React.FC<AlbaranesExplorerProps> = () => {
    const { getPendingDeliveryNotes } = useBilling();
    const { addToast } = useToast();
    const { currentUser, savedClients } = useAppContext();

    // Local state for delivery notes
    const [deliveryNotes, setDeliveryNotes] = useState<DeliveryNote[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Search and filter state
    const [searchTerm, setSearchTerm] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const albaranesColumnOptions: ColumnSelectorOption[] = [
        { id: 'albaranNumber', label: 'Nº Albarán' },
        { id: 'closedAt', label: 'Fecha' },
        { id: 'clientName', label: 'Cliente' },
        { id: 'expedienteNumero', label: 'Expediente' },
        { id: 'total', label: 'Importe' },
        { id: 'status', label: 'Estado' }
    ];
    const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem(ALBARANES_VISIBLE_COLUMNS_KEY);
            if (!raw) return albaranesColumnOptions.map(c => c.id);
            const parsed = JSON.parse(raw) as string[];
            const allowed = new Set(albaranesColumnOptions.map(c => c.id));
            const filtered = parsed.filter(id => allowed.has(id));
            return filtered.length > 0 ? filtered : albaranesColumnOptions.map(c => c.id);
        } catch {
            return albaranesColumnOptions.map(c => c.id);
        }
    });

    // Selection state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [previewAlbaran, setPreviewAlbaran] = useState<DeliveryNote | null>(null);

    // Expediente preview
    const [expedientePreview, setExpedientePreview] = useState<{
        expedienteNumero: string;
        position: { top: number; left: number };
    } | null>(null);

    const [isSearchExpanded, setIsSearchExpanded] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const recentsRef = useRef<HTMLDivElement>(null);
    const [recentIdentifiers, setRecentIdentifiers] = useState<RecentClientIdentifierEntry[]>([]);
    const [isRecentsOpen, setIsRecentsOpen] = useState(false);
    const [isIdentifierPinned, setIsIdentifierPinned] = useState(false);
    const [pinnedIdentifier, setPinnedIdentifier] = useState<string | null>(null);

    // Detect clientId from URL
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    // Menu contextual state
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const visibleColumnsSet = useMemo(() => new Set(visibleColumns), [visibleColumns]);

    useEffect(() => {
        localStorage.setItem(ALBARANES_VISIBLE_COLUMNS_KEY, JSON.stringify(visibleColumns));
    }, [visibleColumns]);

    const toggleVisibleColumn = (id: string) => {
        setVisibleColumns(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
    };

    const getDisplayNameForIdentifier = (identifier: string): string => {
        const normalized = normalizeRecentClientIdentifier(identifier);
        if (!normalized) return '';
        const match = savedClients.find(client =>
            normalizeRecentClientIdentifier(client.documento) === normalized ||
            normalizeRecentClientIdentifier(client.nif) === normalized
        );
        return match?.nombre || match?.legalName || '';
    };

    useEffect(() => {
        const loaded = readRecentClientIdentifiers(currentUser?.id);
        setRecentIdentifiers(loaded.map(entry => ({
            identifier: entry.identifier,
            displayName: entry.displayName || getDisplayNameForIdentifier(entry.identifier)
        })));
    }, [currentUser?.id, savedClients]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.hash.split('?')[1]);
        const clientId = params.get('clientId');
        const identifier = params.get('identifier');
        const clientName = params.get('clientName');
        if (clientId) {
            setSelectedClientId(clientId);
            saveClientNavigationContext({
                active: true,
                clientId,
                identifier: identifier || undefined,
                clientName: clientName || undefined,
                sourceModule: 'billing'
            });
        }
    }, []);

    useEffect(() => {
        if (searchTerm.trim()) return;
        const active = readEffectiveClientIdentifier();
        if (active) setSearchTerm(active);
    }, [searchTerm]);

    useEffect(() => {
        const refreshIdentifierContext = () => {
            const pinned = readIsIdentifierPinned();
            const pinnedValue = readPinnedIdentifier();
            const effective = readEffectiveClientIdentifier();
            setIsIdentifierPinned(pinned);
            setPinnedIdentifier(pinnedValue);
            if (pinned && pinnedValue) {
                setSearchTerm(pinnedValue);
                setIsRecentsOpen(false);
            } else if (!searchTerm && effective) {
                setSearchTerm(effective);
            }
        };
        refreshIdentifierContext();
        window.addEventListener(getIdentifierContextChangedEventName(), refreshIdentifierContext as EventListener);
        return () => window.removeEventListener(getIdentifierContextChangedEventName(), refreshIdentifierContext as EventListener);
    }, [searchTerm]);

    // Load delivery notes
    useEffect(() => {
        loadDeliveryNotes();
    }, []);

    const loadDeliveryNotes = async () => {
        setIsLoading(true);
        const notes = await getPendingDeliveryNotes();
        setDeliveryNotes(notes);
        setIsLoading(false);
    };

    // Generate human-readable albarán number
    const getAlbaranNumber = (note: DeliveryNote, index: number) => {
        // Extract year from closedAt
        const year = new Date(note.closedAt).getFullYear();
        const number = String(index + 1).padStart(4, '0');
        return `ALB-${year}-${number}`;
    };

    // Filter and search logic
    const filteredAlbaranes = useMemo(() => {
        let filtered = [...deliveryNotes];

        // Search (number, client, identity, expediente)
        if (searchTerm) {
            const search = searchTerm.toLowerCase();
            filtered = filtered.filter((note, index) => {
                const albaranNumber = getAlbaranNumber(note, index);
                return albaranNumber.toLowerCase().includes(search) ||
                    note.clientName.toLowerCase().includes(search) ||
                    (note.clientIdentity?.toLowerCase() || '').includes(search) ||
                    note.expedienteNumero.toLowerCase().includes(search);
            });
        }

        return filtered.sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
    }, [deliveryNotes, searchTerm]);

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
        const handleClickOutside = (e: MouseEvent) => {
            if (recentsRef.current && !recentsRef.current.contains(e.target as Node)) {
                setIsRecentsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isRecentsOpen]);

    // Search handlers
    const handleSearchExpand = () => {
        setIsSearchExpanded(true);
        setTimeout(() => searchInputRef.current?.focus(), 10);
    };

    const handleSearchCollapse = () => {
        if (!searchTerm) setIsSearchExpanded(false);
    };

    const handleSearchClear = () => {
        setSearchTerm('');
        setIsSearchExpanded(false);
        setIsRecentsOpen(false);
        clearIdentifierContext();
    };

    const handleSelectRecentIdentifier = (identifier: string) => {
        const name = getDisplayNameForIdentifier(identifier);
        setSearchTerm(identifier);
        setIsRecentsOpen(false);
        const updated = pushRecentClientIdentifier(currentUser?.id, identifier, name);
        if (isIdentifierPinned) {
            setPinnedClientIdentifier(currentUser?.id, identifier, name);
        } else {
            setActiveClientIdentifier(currentUser?.id, identifier, name);
        }
        setRecentIdentifiers(updated.map(entry => ({
            ...entry,
            displayName: entry.displayName || getDisplayNameForIdentifier(entry.identifier)
        })));
        setTimeout(() => searchInputRef.current?.focus(), 50);
    };

    // Selection handlers
    const toggleSelection = (id: string) => {
        const newSelection = new Set(selectedIds);
        if (newSelection.has(id)) {
            newSelection.delete(id);
        } else {
            newSelection.add(id);
        }
        setSelectedIds(newSelection);
    };


    // Quick actions
    const handlePreview = (albaran: DeliveryNote) => {
        setPreviewAlbaran(albaran);
    };

    const handleExpedientePreview = (expedienteNumero: string, event: React.MouseEvent) => {
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        setExpedientePreview({
            expedienteNumero,
            position: {
                top: rect.bottom + 8,
                left: Math.min(rect.left, window.innerWidth - 376) // 360px + 16px margin
            }
        });
    };

    const handleIncorporateToProforma = () => {
        if (selectedIds.size === 0) {
            addToast('Selecciona al menos un albarán', 'warning');
            return;
        }
        // TODO: Open ProformaSelectorModal
        addToast('Funcionalidad en desarrollo: Incorporar a Proforma', 'info');
    };

    const handleConvertToProforma = () => {
        // TODO: Implement conversion flow
        addToast('Funcionalidad en desarrollo: Convertir a Proforma', 'info');
    };

    const handlePrint = () => {
        // TODO: Implement print
        addToast('Generando PDF...', 'info');
    };

    const handleBulkPrint = () => {
        if (selectedIds.size === 0) {
            addToast('Selecciona al menos un albarán', 'warning');
            return;
        }
        addToast(`Imprimiendo ${selectedIds.size} albaranes...`, 'info');
    };

    const getStatusBadge = (status: DeliveryNote['status']) => {
        switch (status) {
            case 'pending':
                return 'bg-amber-50 text-amber-700 border-amber-200';
            case 'invoiced':
                return 'bg-emerald-50 text-emerald-700 border-emerald-200';
            case 'void':
                return 'bg-slate-100 text-slate-500 border-slate-200';
            default:
                return 'bg-slate-50 text-slate-600 border-slate-200';
        }
    };

    const getStatusLabel = (status: DeliveryNote['status']) => {
        switch (status) {
            case 'pending':
                return 'Pendiente';
            case 'invoiced':
                return 'Facturado';
            case 'void':
                return 'Anulado';
            default:
                return status;
        }
    };

    return (
        <div className="flex h-screen bg-slate-50/30 overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0">
                {/* Header - Dashboard Pattern */}
                <div className="px-10 py-8 border-b border-slate-100 flex items-center justify-between shrink-0 no-print">
                    <div className="flex items-center gap-6">
                        <div className="app-tab app-tab-active cursor-default !py-1 !px-0 !h-auto">
                            Albaranes
                        </div>

                        {/* Breadcrumbs */}
                        <Breadcrumbs
                            items={[]}
                            className="hidden lg:flex"
                        />

                        <BackToHubButton />

                        {/* Botón Volver a Clientes - Solo visible cuando se filtra por cliente */}
                        {selectedClientId && (
                            <BackToClientNavigationButton
                                onClick={() => {
                                    setSelectedClientId(null);
                                    navigateToModule(getClientNavigationReturnPath());
                                }}
                            />
                        )}

                        <PremiumFilterButton
                            isActive={showFilters}
                            onClick={() => setShowFilters(!showFilters)}
                            tooltip="Filtrar albaranes"
                        />

                        <ColumnSelectorMenu
                            title="Columnas"
                            options={albaranesColumnOptions}
                            visibleIds={visibleColumns}
                            onToggle={toggleVisibleColumn}
                            iconOnly
                        />
                        <ColumnResizeToggle />
                    </div>
                </div>

                {/* NEW ACTION BAR with Collapsible Search */}
                <div className="px-10 mb-2 no-print">
                    <div className="flex items-center justify-between bg-white border border-[#cfdbe7] rounded-xl px-4 py-3 shadow-sm gap-4">
                        {/* Left side - Collapsible Search Bar */}
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className={`flex items-center gap-2 transition-all duration-300 ${isSearchExpanded ? 'flex-1' : 'flex-shrink-0'}`}>
                                {!isSearchExpanded ? (
                                    <button
                                        onClick={handleSearchExpand}
                                        className="flex items-center gap-2 px-3 py-2 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-all"
                                        title="Buscar"
                                    >
                                        <Search className="w-4 h-4" />
                                        <span className="text-xs font-medium hidden lg:inline">Buscar</span>
                                    </button>
                                ) : (
                                    <div className="relative flex-1 min-w-0">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                        <input
                                            ref={searchInputRef}
                                            type="text"
                                            value={searchTerm}
                                            onChange={(e) => {
                                                if (isIdentifierPinned) return;
                                                const nextValue = e.target.value;
                                                setSearchTerm(nextValue);
                                                if (!nextValue.trim()) {
                                                    clearIdentifierContext();
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key !== 'Enter') return;
                                                const trimmed = searchTerm.trim();
                                                if (!trimmed) return;
                                                const normalized = normalizeRecentClientIdentifier(trimmed);
                                                if (!normalized) return;
                                                const displayName = getDisplayNameForIdentifier(trimmed);
                                                const updated = pushRecentClientIdentifier(currentUser?.id, trimmed, displayName);
                                                if (isIdentifierPinned) {
                                                    setPinnedClientIdentifier(currentUser?.id, trimmed, displayName);
                                                } else {
                                                    setActiveClientIdentifier(currentUser?.id, trimmed, displayName);
                                                }
                                                setRecentIdentifiers(updated.map(entry => ({
                                                    ...entry,
                                                    displayName: entry.displayName || getDisplayNameForIdentifier(entry.identifier)
                                                })));
                                            }}
                                            onBlur={handleSearchCollapse}
                                            placeholder="Buscar por Nº, Cliente, Expediente..."
                                            readOnly={isIdentifierPinned}
                                            className={`w-full pl-10 py-2 border rounded-lg text-sm font-normal text-slate-700 shadow-sm outline-none transition-all placeholder:text-slate-400 ${isIdentifierPinned
                                                ? 'pr-[220px] bg-sky-50 border-sky-200'
                                                : 'pr-[220px] border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500/10 focus:border-sky-500'
                                                }`}
                                        />
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex items-center gap-2">
                                            {searchTerm && (
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
                                                    const candidate = normalizeRecentClientIdentifier(searchTerm || pinnedIdentifier || '');
                                                    if (!candidate) return;
                                                    setPinnedClientIdentifier(currentUser?.id, candidate, getDisplayNameForIdentifier(candidate));
                                                }}
                                                className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${isIdentifierPinned
                                                    ? 'border-sky-300 bg-sky-100 text-sky-700'
                                                    : 'border-slate-200 bg-white text-slate-400 hover:text-sky-600 hover:border-sky-200'
                                                    }`}
                                                title={isIdentifierPinned ? "Identificador fijado (clic para desfijar)" : "Fijar identificador"}
                                            >
                                                <Pin className="w-3.5 h-3.5" />
                                            </button>
                                            <div ref={recentsRef}>
                                            <button
                                                type="button"
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    setIsRecentsOpen(v => !v);
                                                }}
                                                className="h-8 px-2.5 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 transition-colors"
                                                title="Identificadores recientes de esta sesión"
                                            >
                                                <History className="w-3.5 h-3.5" />
                                                <span className="text-[10px] font-semibold uppercase tracking-wider">Recientes</span>
                                                <ChevronDown className={`w-3 h-3 transition-transform ${isRecentsOpen ? 'rotate-180' : ''}`} />
                                            </button>

                                            {isRecentsOpen && (
                                                <div className="absolute z-[120] right-0 top-[calc(100%+8px)] w-72 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
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
                                    </div>
                                )}
                            </div>

                            {/* Selection chip */}
                            {selectedIds.size > 0 && (
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-sky-50 border border-sky-100 rounded-full shrink-0">
                                    <div className="size-5 rounded-full bg-sky-500 text-white flex items-center justify-center text-[10px] font-bold">
                                        {selectedIds.size}
                                    </div>
                                    <span className="text-[11px] font-medium text-sky-700 whitespace-nowrap">
                                        Seleccionado{selectedIds.size > 1 ? 's' : ''}
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-1">
                            <div className="flex items-center bg-slate-50 border border-slate-100 rounded-lg p-1 mr-2 gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleBulkPrint}
                                    disabled={selectedIds.size === 0}
                                    title="Imprimir selección"
                                    className={cn(selectedIds.size > 0 && "hover:text-sky-600 hover:bg-white hover:shadow-sm")}
                                >
                                    <Printer className="size-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleIncorporateToProforma}
                                    disabled={selectedIds.size === 0}
                                    title="Incorporar selección"
                                    className={cn(selectedIds.size > 0 && "hover:text-amber-600 hover:bg-white hover:shadow-sm")}
                                >
                                    <Plus className="size-4" />
                                </Button>
                            </div>

                            <Button
                                variant="ghost"
                                size="md"
                                onClick={() => loadDeliveryNotes()}
                                icon={ArrowUpDown}
                                className="hover:text-slate-600 hover:bg-slate-50"
                            >
                                Recargar
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Table View */}
                <div className="flex-1 overflow-hidden px-10 pb-6">
                    {isLoading ? (
                        <div className="h-full flex items-center justify-center bg-white border border-[#cfdbe7] rounded-xl shadow-sm">
                            <div className="text-center">
                                <svg className="animate-spin h-8 w-8 text-sky-600 mx-auto mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <p className="text-sm text-slate-500">Cargando albaranes...</p>
                            </div>
                        </div>
                    ) : (
                        <ResizableExplorerTable
                            data={filteredAlbaranes}
                            columns={[
                                {
                                    id: 'select',
                                    label: '',
                                    minWidth: 40,
                                    defaultWidth: 44,
                                    align: 'center',
                                    sortable: false,
                                    render: (a) => (
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(a.id)}
                                            onChange={() => toggleSelection(a.id)}
                                            className="h-4 w-4 rounded border-slate-200 border-2 bg-transparent text-[#4c739a] checked:bg-[#4c739a] checked:border-[#4c739a] focus:ring-0 focus:ring-offset-0 focus:border-slate-200 focus:outline-none"
                                        />
                                    )
                                },
                                ...(visibleColumnsSet.has('albaranNumber') ? [{
                                    id: 'albaranNumber',
                                    label: 'Nº Albarán',
                                    minWidth: 120,
                                    defaultWidth: 160,
                                    render: (a: DeliveryNote) => <span className="font-mono text-sky-700 whitespace-nowrap truncate block">{getAlbaranNumber(a, deliveryNotes.indexOf(a))}</span>
                                }] : []),
                                ...(visibleColumnsSet.has('closedAt') ? [{
                                    id: 'closedAt',
                                    label: 'Fecha',
                                    minWidth: 80,
                                    defaultWidth: 100,
                                    align: 'center' as const,
                                    render: (a: DeliveryNote) => <span className="text-slate-500 text-[11px] uppercase tracking-tight">{new Date(a.closedAt).toLocaleDateString('es-ES')}</span>
                                }] : []),
                                ...(visibleColumnsSet.has('clientName') ? [{
                                    id: 'clientName',
                                    label: 'Cliente',
                                    minWidth: 150,
                                    defaultWidth: 300,
                                    render: (a: DeliveryNote) => <span className="text-slate-700 font-medium truncate block" title={a.clientName}>{a.clientName}</span>
                                }] : []),
                                ...(visibleColumnsSet.has('expedienteNumero') ? [{
                                    id: 'expedienteNumero',
                                    label: 'Expediente',
                                    minWidth: 120,
                                    defaultWidth: 160,
                                    render: (a: DeliveryNote) => (
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-slate-700 whitespace-nowrap truncate">{a.expedienteNumero}</span>
                                            <button
                                                onClick={(e) => handleExpedientePreview(a.expedienteNumero, e)}
                                                className="p-1 text-slate-300 hover:text-sky-600 transition-colors"
                                            >
                                                <Eye size={12} />
                                            </button>
                                        </div>
                                    )
                                }] : []),
                                ...(visibleColumnsSet.has('total') ? [{
                                    id: 'total',
                                    label: 'Importe',
                                    minWidth: 80,
                                    defaultWidth: 120,
                                    align: 'right' as const,
                                    render: (a: DeliveryNote) => <span className="text-slate-700 font-bold">{a.total.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</span>
                                }] : []),
                                ...(visibleColumnsSet.has('status') ? [{
                                    id: 'status',
                                    label: 'Estado',
                                    minWidth: 100,
                                    defaultWidth: 120,
                                    render: (a: DeliveryNote) => (
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border border-transparent ${getStatusBadge(a.status)}`}>
                                            {getStatusLabel(a.status)}
                                        </span>
                                    )
                                }] : []),
                                {
                                    id: 'actions',
                                    label: '',
                                    minWidth: 40,
                                    defaultWidth: 120,
                                    align: 'center',
                                    sortable: false,
                                    render: (a) => (
                                        <div className="relative flex items-center justify-center">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                    setOpenMenuId(openMenuId === a.id ? null : a.id);
                                                    setMenuPos({
                                                        top: rect.bottom + window.scrollY,
                                                        left: rect.left + window.scrollX - 150
                                                    });
                                                }}
                                                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all"
                                                title="Acciones"
                                            >
                                                <MoreHorizontal className="w-4 h-4" />
                                            </button>

                                            {/* Context Menu */}
                                            {openMenuId === a.id && menuPos && (
                                                <div
                                                    ref={menuRef}
                                                    className="fixed bg-white rounded-xl shadow-2xl border border-slate-200 py-2 w-48 z-[9999] animate-in fade-in slide-in-from-top-2 duration-200"
                                                    style={{
                                                        top: `${menuPos.top}px`,
                                                        left: `${menuPos.left}px`
                                                    }}
                                                >
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handlePreview(a); }}
                                                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors flex items-center gap-3"
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                        Vista previa
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleConvertToProforma(); }}
                                                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-sky-50 hover:text-sky-700 transition-colors flex items-center gap-3"
                                                    >
                                                        <FileText className="w-4 h-4" />
                                                        Crear Proforma
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleIncorporateToProforma(); }}
                                                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-sky-50 hover:text-sky-700 transition-colors flex items-center gap-3"
                                                    >
                                                        <Plus className="w-4 h-4" />
                                                        Añadir a Proforma
                                                    </button>
                                                    <div className="my-1 border-t border-slate-100" />
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handlePrint(); }}
                                                        className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors flex items-center gap-3"
                                                    >
                                                        <Printer className="w-4 h-4" />
                                                        Imprimir
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )
                                }
                            ]}
                            storageKey="albaranes-table-widths"
                            rowIdKey="id"
                            selectedRowIds={Array.from(selectedIds) as any}
                            onRowClick={(a) => handlePreview(a)}
                        />
                    )}
                </div>
            </div>

            {/* Expediente preview popover */}
            {expedientePreview && (
                <ExpedientePreviewPopover
                    expedienteNumero={expedientePreview.expedienteNumero}
                    position={expedientePreview.position}
                    onClose={() => setExpedientePreview(null)}
                />
            )}

            {/* Preview modal (Albarán) */}
            {previewAlbaran && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 no-print">
                    <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-slate-800">
                                Albarán {getAlbaranNumber(previewAlbaran, deliveryNotes.indexOf(previewAlbaran))}
                            </h2>
                            <button
                                onClick={() => setPreviewAlbaran(null)}
                                className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-all"
                            >
                                <X size={24} />
                            </button>
                        </div>
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <div>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Cliente</span>
                                    <p className="text-sm text-slate-700 font-medium">{previewAlbaran.clientName}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Expediente</span>
                                    <p className="text-sm text-slate-700 font-mono font-medium">{previewAlbaran.expedienteNumero}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Fecha</span>
                                    <p className="text-sm text-slate-700 font-medium">
                                        {new Date(previewAlbaran.closedAt).toLocaleDateString('es-ES')}
                                    </p>
                                </div>
                                <div>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Total</span>
                                    <p className="text-lg font-bold text-sky-700">
                                        {previewAlbaran.total.toLocaleString('es-ES', {
                                            style: 'currency',
                                            currency: 'EUR'
                                        })}
                                    </p>
                                </div>
                            </div>
                            <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">Conceptos</span>
                                <div className="space-y-2">
                                    {previewAlbaran.lines.map((line, i) => (
                                        <div key={i} className="flex justify-between text-sm py-2 border-b border-slate-100 last:border-0">
                                            <span className="text-slate-700">{line.concept}</span>
                                            <span className="text-slate-900 font-bold whitespace-nowrap">
                                                {line.amount.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AlbaranesExplorer;
