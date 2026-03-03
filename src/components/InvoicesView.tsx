import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Printer, Eye, Trash2, Copy, MoreHorizontal, Ban, ExternalLink, Banknote, X, Search, History, ChevronDown, Pin } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { CopyAction } from './ui/ActionFeedback';
import { useToast } from '@/hooks/useToast';
import BillingFiltersPanel, { BillingFilters } from './BillingFiltersPanel';
import InvoiceDetailModal from './InvoiceDetailModal';
import InvoicePDFDocument from './InvoicePDFDocument';
import { Invoice, InvoiceStatus } from '../types/billing';
import { useInvoices } from '../hooks/useInvoices';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { BackToHubButton } from './ui/BackToHubButton';
import { BackToClientNavigationButton } from './ui/BackToClientNavigationButton';
import { useConfirmation, confirmVoid, confirmDelete } from '@/hooks/useConfirmation';
import ConfirmationModal from './ConfirmationModal';
import Breadcrumbs from './ui/Breadcrumbs';
import { ColumnSelectorMenu, type ColumnSelectorOption } from './ui/ColumnSelectorMenu';
import { PremiumFilterButton } from './ui/PremiumFilterButton';
import { InputClearButton } from './ui/InputClearButton';
import { ColumnResizeToggle } from './ui/ColumnResizeToggle';
import { navigateToModule } from '@/utils/moduleNavigation';
import { ResizableExplorerTable } from './ui/ResizableExplorerTable';
import PaginationControls, { PageSize } from './PaginationControls';
import {
    getClientNavigationReturnPath,
    saveClientNavigationContext
} from '@/utils/clientNavigationContext';
import { toUiTitleCase } from '@/utils/titleCase';
import {
    clearIdentifierContext,
    getIdentifierContextChangedEventName,
    normalizeRecentClientIdentifier,
    readEffectiveClientIdentifier,
    readIsIdentifierPinned,
    readPinnedIdentifier,
    readRecentClientIdentifiers,
    setActiveClientIdentifier,
    setPinnedClientIdentifier,
    unpinClientIdentifier,
    type RecentClientIdentifierEntry,
} from '@/utils/recentClientIdentifiers';

interface InvoicesViewProps {
    onViewCase?: (caseId: string) => void;
}

const INVOICES_VISIBLE_FIELDS_KEY = 'invoices-visible-fields-v1';
const FILTER_PANEL_AUTO_CLOSE_MS = 20000;
const INVOICES_FILTERS_PINNED_KEY = 'invoices-filters-pinned';

const statusLabels: Record<InvoiceStatus, { label: string; color: string }> = {
    draft: { label: 'Borrador', color: 'bg-slate-100 text-slate-600' },
    issued: { label: 'Emitida', color: 'bg-emerald-100 text-emerald-600' },
    void: { label: 'Anulada', color: 'bg-slate-200 text-slate-500' }
};

const InvoicesView: React.FC<InvoicesViewProps> = ({ onViewCase }) => {
    const { subscribeToInvoices, deleteInvoice, voidInvoice, markAsPaid } = useInvoices();
    const { addToast } = useToast();
    const { company } = useCompanySettings();

    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);

    const [filters, setFilters] = useState<BillingFilters>({
        searchQuery: '',
        clientId: null,
        clientLabel: '',
        caseId: '',
        prefix: '',
        ejercicio: '',
        responsibleId: '',
        responsibleLabel: '',
        dateType: 'createdAt',
        startDate: '',
        endDate: '',
        status: 'Todos'
    });

    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(() => {
        const saved = localStorage.getItem('invoices-filters-open');
        return saved === 'true';
    });
    const [isFilterPanelPinned, setIsFilterPanelPinned] = useState(() => {
        return localStorage.getItem(INVOICES_FILTERS_PINNED_KEY) === 'true';
    });

    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState<PageSize>(25);

    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [isRecentsOpen, setIsRecentsOpen] = useState(false);
    const [recentIdentifiers, setRecentIdentifiers] = useState<RecentClientIdentifierEntry[]>([]);
    const [isIdentifierPinned, setIsIdentifierPinned] = useState(false);
    const [pinnedIdentifier, setPinnedIdentifier] = useState<string | null>(null);
    const recentsRef = useRef<HTMLDivElement>(null);

    const { confirmationState, confirm, closeConfirmation } = useConfirmation();

    const invoicesFieldOptions: ColumnSelectorOption[] = [
        { id: 'number', label: 'Número' },
        { id: 'identifier', label: 'Identificador' },
        { id: 'client', label: 'Cliente' },
        { id: 'amount', label: 'Importe' },
        { id: 'status', label: 'Estado' }
    ];

    const [visibleFields, setVisibleFields] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem(INVOICES_VISIBLE_FIELDS_KEY);
            if (!raw) return invoicesFieldOptions.map(f => f.id);
            const parsed = JSON.parse(raw) as string[];
            const allowed = new Set(invoicesFieldOptions.map(f => f.id));
            const filtered = parsed.filter(id => allowed.has(id));
            if (!filtered.includes('identifier')) filtered.push('identifier');
            return filtered.length > 0 ? filtered : invoicesFieldOptions.map(f => f.id);
        } catch {
            return invoicesFieldOptions.map(f => f.id);
        }
    });

    const visibleFieldsSet = useMemo(() => new Set(visibleFields), [visibleFields]);

    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (filters.clientId) count++;
        if (filters.ejercicio) count++;
        if (filters.startDate || filters.endDate) count++;
        if ((filters.searchQuery || '').trim()) count++;
        return count;
    }, [filters]);

    const hasInvoiceExplorerCriteria = useMemo(() => {
        const hasSearch = (filters.searchQuery || '').trim().length > 0;
        const hasClient = !!filters.clientId;
        const hasEjercicio = (filters.ejercicio || '').trim().length > 0;
        const hasDates = !!filters.startDate || !!filters.endDate;
        return hasSearch || hasClient || hasEjercicio || hasDates;
    }, [filters]);

    useEffect(() => {
        localStorage.setItem(INVOICES_VISIBLE_FIELDS_KEY, JSON.stringify(visibleFields));
    }, [visibleFields]);

    useEffect(() => {
        localStorage.setItem(INVOICES_FILTERS_PINNED_KEY, String(isFilterPanelPinned));
    }, [isFilterPanelPinned]);

    useEffect(() => {
        if (isFilterPanelOpen && activeFilterCount === 0 && !isFilterPanelPinned) {
            const timer = setTimeout(() => {
                setIsFilterPanelOpen(false);
                localStorage.setItem('invoices-filters-open', 'false');
            }, FILTER_PANEL_AUTO_CLOSE_MS);
            return () => clearTimeout(timer);
        }
    }, [isFilterPanelOpen, activeFilterCount, isFilterPanelPinned]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.hash.split('?')[1]);
        const clientId = params.get('clientId');
        const identifier = params.get('identifier');
        const clientName = params.get('clientName');
        if (clientId) {
            setSelectedClientId(clientId);
            setFilters(prev => ({ ...prev, clientId }));
            saveClientNavigationContext({
                active: true,
                clientId,
                identifier: identifier || undefined,
                clientName: clientName || undefined,
                sourceModule: 'invoices'
            });
        }

        setRecentIdentifiers(readRecentClientIdentifiers());
    }, []);

    useEffect(() => {
        if ((filters.searchQuery || '').trim().length > 0) return;
        const active = readEffectiveClientIdentifier();
        if (!active) return;
        setFilters(prev => ({ ...prev, searchQuery: active }));
    }, [filters.searchQuery]);

    useEffect(() => {
        const refreshIdentifierContext = () => {
            const pinned = readIsIdentifierPinned();
            const pinnedValue = readPinnedIdentifier();
            const effective = readEffectiveClientIdentifier();
            setIsIdentifierPinned(pinned);
            setPinnedIdentifier(pinnedValue);
            if (pinned && pinnedValue) {
                setFilters(prev => ({ ...prev, searchQuery: pinnedValue }));
                setIsRecentsOpen(false);
            } else if (!(filters.searchQuery || '').trim() && effective) {
                setFilters(prev => ({ ...prev, searchQuery: effective }));
            }
        };
        refreshIdentifierContext();
        window.addEventListener(getIdentifierContextChangedEventName(), refreshIdentifierContext as EventListener);
        return () => window.removeEventListener(getIdentifierContextChangedEventName(), refreshIdentifierContext as EventListener);
    }, [filters.searchQuery]);

    useEffect(() => {
        if (!isRecentsOpen) return;
        const onDocMouseDown = (e: MouseEvent) => {
            if (recentsRef.current && !recentsRef.current.contains(e.target as Node)) {
                setIsRecentsOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocMouseDown);
        return () => document.removeEventListener('mousedown', onDocMouseDown);
    }, [isRecentsOpen]);

    useEffect(() => {
        if (!hasInvoiceExplorerCriteria) {
            setInvoices([]);
            return;
        }
        const unsubscribe = subscribeToInvoices((data) => {
            setInvoices(data);
        });
        return () => unsubscribe();
    }, [subscribeToInvoices, hasInvoiceExplorerCriteria]);

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

    const toggleVisibleField = (id: string) => {
        setVisibleFields(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
    };

    const handleClearFilters = () => {
        setFilters({
            searchQuery: '',
            clientId: null,
            clientLabel: '',
            caseId: '',
            prefix: '',
            ejercicio: '',
            responsibleId: '',
            responsibleLabel: '',
            dateType: 'createdAt',
            startDate: '',
            endDate: '',
            status: 'Todos'
        });
    };

    const handleDelete = async (invoice: Invoice) => {
        if (invoice.status !== 'draft') {
            const confirmed = await confirm({
                ...confirmVoid('factura'),
                message: `La factura ${invoice.number} será anulada.`,
                description: 'La factura perderá su validez legal y se generará un registro de anulación. Esta acción no se puede deshacer.'
            });
            if (!confirmed) return;
            try {
                await voidInvoice(invoice.id);
                addToast('Factura anulada correctamente', 'success');
            } catch (error) {
                console.error(error);
                addToast('Error al anular factura', 'error');
            }
            return;
        }

        const confirmed = await confirm({
            ...confirmDelete('factura'),
            message: 'La factura borrador será eliminada permanentemente.',
            description: 'Esta acción no se puede deshacer. El borrador será eliminado de la base de datos.'
        });
        if (!confirmed) return;

        try {
            await deleteInvoice(invoice.id);
            addToast('Factura eliminada correctamente', 'success');
        } catch (error) {
            console.error(error);
            addToast('Error al eliminar factura', 'error');
        }
    };

    const handleDownloadPdf = async (invoice: Invoice) => {
        const blob = await pdf(<InvoicePDFDocument invoice={invoice} company={company} />).toBlob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `factura - ${invoice.number || invoice.id.slice(0, 8)}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
        addToast('PDF descargado', 'success');
    };

    const handleInvoiceUpdated = () => {
        setIsDetailOpen(false);
        setSelectedInvoice(null);
    };

    const emitHelpAction = (action: string, durationMs?: number) => {
        window.dispatchEvent(new CustomEvent('aga:help-action', { detail: { action, durationMs } }));
    };

    const emitHelpError = (error: string) => {
        window.dispatchEvent(new CustomEvent('aga:help-error', { detail: { error } }));
    };

    const filteredInvoices = useMemo(() => invoices.filter(inv => {
        if (!hasInvoiceExplorerCriteria) return false;

        if (filters.searchQuery) {
            const q = filters.searchQuery.toLowerCase();
            const matchesSearch =
                (inv.number || '').toLowerCase().includes(q) ||
                (inv.clientName || '').toLowerCase().includes(q) ||
                (inv.clientIdentity || '').toLowerCase().includes(q) ||
                (inv.expedienteNumero || '').toLowerCase().includes(q);
            if (!matchesSearch) return false;
        }

        if (filters.clientId && inv.clientId !== filters.clientId) return false;
        if (filters.ejercicio) {
            const invoiceYear =
                inv.year ||
                (inv.issuedAt ? new Date(inv.issuedAt).getFullYear() : undefined) ||
                (inv.createdAt ? new Date(inv.createdAt).getFullYear() : undefined);
            if (!invoiceYear || String(invoiceYear) !== filters.ejercicio) return false;
        }

        if (filters.startDate || filters.endDate) {
            const baseDate = inv.createdAt ? new Date(inv.createdAt) : null;
            if (!baseDate) return false;
            if (filters.startDate && baseDate < new Date(filters.startDate)) return false;
            if (filters.endDate) {
                const end = new Date(filters.endDate);
                end.setHours(23, 59, 59, 999);
                if (baseDate > end) return false;
            }
        }

        if (filters.status === 'Pendientes') {
            if (!(inv.status === 'issued' && !inv.isPaid)) return false;
        } else if (filters.status === 'Cobradas') {
            if (!inv.isPaid) return false;
        }

        return true;
    }), [invoices, filters, hasInvoiceExplorerCriteria]);

    useEffect(() => {
        if (hasInvoiceExplorerCriteria && filteredInvoices.length === 0) {
            emitHelpError('EMPTY_RESULT');
        }
    }, [hasInvoiceExplorerCriteria, filteredInvoices.length]);

    const orderedInvoices = useMemo(() => {
        const data = [...filteredInvoices];
        if (!sortConfig) return data;

        data.sort((a, b) => {
            let aVal: string | number = '';
            let bVal: string | number = '';

            switch (sortConfig.key) {
                case 'number':
                    aVal = a.number || '';
                    bVal = b.number || '';
                    break;
                case 'client':
                    aVal = a.clientName || '';
                    bVal = b.clientName || '';
                    break;
                case 'identifier':
                    aVal = a.clientIdentity || '';
                    bVal = b.clientIdentity || '';
                    break;
                case 'amount':
                    aVal = Number(a.total || 0);
                    bVal = Number(b.total || 0);
                    break;
                case 'status':
                    aVal = a.status || '';
                    bVal = b.status || '';
                    break;
                case 'createdAt':
                    aVal = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    bVal = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    break;
                default:
                    aVal = '';
                    bVal = '';
            }

            if (typeof aVal === 'string' || typeof bVal === 'string') {
                const cmp = String(aVal).localeCompare(String(bVal), 'es', { sensitivity: 'base', numeric: true });
                return sortConfig.direction === 'asc' ? cmp : -cmp;
            }
            return sortConfig.direction === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
        });

        return data;
    }, [filteredInvoices, sortConfig]);

    const totalItems = orderedInvoices.length;
    const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalItems / (pageSize as number)));
    const paginatedInvoices = useMemo(() => {
        if (pageSize === 'all') return orderedInvoices;
        const start = (currentPage - 1) * (pageSize as number);
        return orderedInvoices.slice(start, start + (pageSize as number));
    }, [orderedInvoices, currentPage, pageSize]);

    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(1);
    }, [currentPage, totalPages]);

    const handleSort = (key: string) => {
        setSortConfig(prev => {
            if (prev?.key === key) return prev.direction === 'asc' ? { key, direction: 'desc' } : null;
            return { key, direction: 'asc' };
        });
    };

    const selectedIdentifier = (filters.searchQuery || '').trim();
    const selectedClientName = useMemo(() => {
        if ((filters.clientLabel || '').trim()) return toUiTitleCase(filters.clientLabel);
        if (!selectedIdentifier) return '';
        const normalizedIdentifier = selectedIdentifier.toLowerCase();
        const match = invoices.find(inv => String(inv.clientIdentity || '').toLowerCase() === normalizedIdentifier);
        return match?.clientName ? toUiTitleCase(match.clientName) : '';
    }, [filters.clientLabel, selectedIdentifier, invoices]);

    const handleSelectRecentIdentifier = (identifier: string) => {
        const normalizedIdentifier = String(identifier || '').trim().toUpperCase();
        if (!normalizedIdentifier) return;

        const match = invoices.find(inv => String(inv.clientIdentity || '').toUpperCase() === normalizedIdentifier);
        if (isIdentifierPinned) {
            setPinnedClientIdentifier(undefined, normalizedIdentifier, match?.clientName || '');
        } else {
            setActiveClientIdentifier(undefined, normalizedIdentifier, match?.clientName || '');
        }
        setFilters(prev => ({
            ...prev,
            searchQuery: normalizedIdentifier,
            clientLabel: match?.clientName || prev.clientLabel || ''
        }));
        setIsRecentsOpen(false);
    };

    return (
        <div className="flex h-full bg-[#fcfdfe] overflow-hidden">
            <BillingFiltersPanel
                filters={filters}
                onFilterChange={setFilters}
                onClear={handleClearFilters}
                onClose={() => setIsFilterPanelOpen(false)}
                isOpen={isFilterPanelOpen}
                isPinned={isFilterPanelPinned}
                onTogglePin={() => setIsFilterPanelPinned(prev => !prev)}
                showEjercicio={true}
                showCaseFilter={false}
                showPrefixFilter={false}
                showResponsibleFilter={false}
                showStatusFilter={true}
            />

            <div className="flex-1 flex flex-col h-full bg-[#fcfdfe] overflow-hidden">
                <div className="bg-white border-b border-slate-200 px-10 py-8 flex-none">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-6">
                            <div className="app-tab app-tab-active cursor-default !py-1 !px-0 !h-auto">Facturas</div>
                            <Breadcrumbs items={[]} className="hidden lg:flex" />
                            <BackToHubButton />

                            {selectedClientId && (
                                <BackToClientNavigationButton
                                    onClick={() => {
                                        setSelectedClientId(null);
                                        navigateToModule(getClientNavigationReturnPath());
                                    }}
                                />
                            )}

                            <PremiumFilterButton
                                isActive={isFilterPanelOpen}
                                onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                                tooltip={`Filtrar facturas${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}
                            />

                            <ColumnSelectorMenu
                                title="Columnas"
                                options={invoicesFieldOptions}
                                visibleIds={visibleFields}
                                onToggle={toggleVisibleField}
                                iconOnly
                            />
                            <ColumnResizeToggle />

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
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8 relative">
                    <div className="max-w-7xl mx-auto">
                        <div className="flex items-center justify-between bg-white border border-[#cfdbe7] rounded-xl px-4 py-3 shadow-sm mb-3 gap-4">
                            <div className="relative min-w-0 flex-[1.2]">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <input
                                    type="text"
                                    value={filters.searchQuery}
                                    onChange={(e) => {
                                        if (isIdentifierPinned) return;
                                        const nextValue = e.target.value;
                                        setFilters(prev => ({ ...prev, searchQuery: nextValue }));
                                        setIsRecentsOpen(false);
                                        if (!nextValue.trim()) {
                                            clearIdentifierContext();
                                        }
                                    }}
                                    placeholder="Identificador (DNI/CIF)"
                                    readOnly={isIdentifierPinned}
                                    className={`w-full pl-10 py-2 border rounded-lg text-sm font-normal text-slate-700 shadow-sm outline-none transition-all placeholder:text-slate-400 ${isIdentifierPinned
                                        ? 'pr-[220px] bg-sky-50 border-sky-200'
                                        : 'pr-[220px] border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500/10 focus:border-sky-500'
                                        }`}
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex items-center gap-2">
                                    {(filters.searchQuery || '').trim().length > 0 && (
                                        <InputClearButton
                                            onClick={() => {
                                                setFilters(prev => ({ ...prev, searchQuery: '' }));
                                                setIsRecentsOpen(false);
                                                clearIdentifierContext();
                                            }}
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
                                            const candidate = normalizeRecentClientIdentifier((filters.searchQuery || '').trim() || pinnedIdentifier || '');
                                            if (!candidate) return;
                                            setPinnedClientIdentifier(undefined, candidate, selectedClientName || '');
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
                                        emitHelpAction('RECENT_IDENTIFIER_SELECTED');
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
                            <div className="flex-1 min-w-0">
                                <div className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-slate-700 bg-slate-50 shadow-sm truncate">
                                    {selectedClientName || 'Nombre del identificador seleccionado'}
                                </div>
                            </div>
                        </div>

                        {hasInvoiceExplorerCriteria && (
                            <ResizableExplorerTable
                                data={paginatedInvoices}
                                columns={[
                                    ...(visibleFieldsSet.has('number') ? [{
                                        id: 'number',
                                        label: 'Número',
                                        minWidth: 150,
                                        defaultWidth: 170,
                                        render: (invoice: Invoice) => invoice.number ? (
                                            <CopyAction text={invoice.number}>
                                                <div className="flex items-center gap-2 group/copy">
                                                    <span className="font-mono text-slate-700">{invoice.number}</span>
                                                    <Copy size={12} className="text-slate-300 group-hover/copy:text-sky-500" />
                                                </div>
                                            </CopyAction>
                                        ) : <span className="text-slate-400 italic">Borrador</span>
                                    }] : []),
                                    ...(visibleFieldsSet.has('client') ? [{
                                        id: 'client',
                                        label: 'Cliente',
                                        minWidth: 220,
                                        defaultWidth: 300,
                                        truncate: false,
                                        render: (invoice: Invoice) => <span className="text-slate-700 whitespace-normal break-words">{toUiTitleCase(invoice.clientName) || 'Sin cliente'}</span>
                                    }] : []),
                                    ...(visibleFieldsSet.has('identifier') ? [{
                                        id: 'identifier',
                                        label: 'Identificador',
                                        minWidth: 130,
                                        defaultWidth: 160,
                                        render: (invoice: Invoice) => invoice.clientIdentity ? (
                                            <CopyAction text={invoice.clientIdentity}>
                                                <div className="inline-flex items-center gap-2 group/copy">
                                                    <span className="font-mono text-slate-600">{invoice.clientIdentity}</span>
                                                    <Copy size={12} className="text-slate-300 group-hover/copy:text-sky-500" />
                                                </div>
                                            </CopyAction>
                                        ) : <span className="font-mono text-slate-600">—</span>
                                    }] : []),
                                    {
                                        id: 'case',
                                        label: 'Expediente',
                                        minWidth: 130,
                                        defaultWidth: 170,
                                        render: (invoice: Invoice) => <span className="font-mono text-slate-600">{invoice.expedienteNumero || '—'}</span>
                                    },
                                    ...(visibleFieldsSet.has('amount') ? [{
                                        id: 'amount',
                                        label: 'Importe',
                                        minWidth: 120,
                                        defaultWidth: 140,
                                        align: 'right' as const,
                                        render: (invoice: Invoice) => <span className="inline-block w-full text-right">{new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(invoice.total || 0)}</span>
                                    }] : []),
                                    ...(visibleFieldsSet.has('status') ? [{
                                        id: 'status',
                                        label: 'Estado',
                                        minWidth: 120,
                                        defaultWidth: 150,
                                        render: (invoice: Invoice) => {
                                            const statusInfo = statusLabels[invoice.status];
                                            return (
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusInfo.color}`}>
                                                        {statusInfo.label}
                                                    </span>
                                                    {invoice.status === 'issued' && (
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${invoice.isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                            {invoice.isPaid ? 'Pagada' : 'Pendiente'}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        }
                                    }] : []),
                                    {
                                        id: 'createdAt',
                                        label: 'Fecha',
                                        minWidth: 110,
                                        defaultWidth: 120,
                                        align: 'right' as const,
                                        render: (invoice: Invoice) => <span className="inline-block w-full text-right text-[11px] text-slate-500">{invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString('es-ES') : '—'}</span>
                                    },
                                    {
                                        id: 'actions',
                                        label: 'Acciones',
                                        minWidth: 60,
                                        defaultWidth: 70,
                                        align: 'center' as const,
                                        sortable: false,
                                        render: (invoice: Invoice) => (
                                            <div className="relative flex justify-center">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (openMenuId === invoice.id) {
                                                            setOpenMenuId(null);
                                                            setMenuPos(null);
                                                        } else {
                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                            let top = rect.bottom + 6;
                                                            let left = rect.right - 192;
                                                            if (left < 16) left = 16;
                                                            if (top + 200 > window.innerHeight) top = rect.top - 200;
                                                            setMenuPos({ top, left });
                                                            setOpenMenuId(invoice.id);
                                                        }
                                                    }}
                                                    className={`p-2 rounded-lg transition-all duration-150 ${openMenuId === invoice.id ? 'bg-slate-200 text-slate-700 opacity-100' : 'text-slate-400 opacity-50 hover:opacity-100 hover:bg-slate-100'}`}
                                                >
                                                    <MoreHorizontal className="w-4 h-4" />
                                                </button>

                                                {openMenuId === invoice.id && menuPos && (
                                                    <div
                                                        ref={menuRef}
                                                        style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
                                                        className="w-48 bg-white border border-slate-200 rounded-lg shadow-xl z-[9999] py-1"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <button
                                                            onClick={() => { setSelectedInvoice(invoice); setIsDetailOpen(true); setOpenMenuId(null); setMenuPos(null); }}
                                                            className="w-full text-left px-3 py-2 text-xs font-normal text-slate-600 hover:bg-slate-50 hover:text-indigo-600 flex items-center gap-2"
                                                        >
                                                            <Eye className="w-3.5 h-3.5" /> Vista Previa
                                                        </button>
                                                        <button
                                                            onClick={async () => { setOpenMenuId(null); setMenuPos(null); await handleDownloadPdf(invoice); }}
                                                            className="w-full text-left px-3 py-2 text-xs font-normal text-slate-600 hover:bg-slate-50 hover:text-emerald-600 flex items-center gap-2"
                                                        >
                                                            <Printer className="w-3.5 h-3.5" /> Descargar PDF
                                                        </button>
                                                        {invoice.expedienteId && onViewCase && (
                                                            <button
                                                                onClick={() => { setOpenMenuId(null); setMenuPos(null); onViewCase(invoice.expedienteId!); }}
                                                                className="w-full text-left px-3 py-2 text-xs font-normal text-slate-600 hover:bg-slate-50 hover:text-sky-600 flex items-center gap-2"
                                                            >
                                                                <ExternalLink className="w-3.5 h-3.5" /> Ir al expediente
                                                            </button>
                                                        )}
                                                        {invoice.status === 'issued' && !invoice.isPaid && (
                                                            <button
                                                                onClick={async () => {
                                                                    setOpenMenuId(null);
                                                                    setMenuPos(null);
                                                                    await markAsPaid(invoice.id);
                                                                }}
                                                                className="w-full text-left px-3 py-2 text-xs font-normal text-emerald-600 hover:bg-emerald-50 flex items-center gap-2"
                                                            >
                                                                <Banknote className="w-3.5 h-3.5" /> Marcar Pagada
                                                            </button>
                                                        )}
                                                        <div className="h-px bg-slate-100 my-1" />
                                                        <button
                                                            onClick={() => { handleDelete(invoice); setOpenMenuId(null); setMenuPos(null); }}
                                                            className="w-full text-left px-3 py-2 text-xs font-normal text-red-500 hover:bg-red-50 flex items-center gap-2"
                                                        >
                                                            {invoice.status === 'draft' ? (
                                                                <><Trash2 className="w-3.5 h-3.5" /> Eliminar</>
                                                            ) : (
                                                                <><Ban className="w-3.5 h-3.5" /> Anular</>
                                                            )}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    }
                                ]}
                                storageKey="invoice-table-col-widths"
                                rowIdKey="id"
                                sortConfig={sortConfig}
                                onSort={handleSort}
                                onRowDoubleClick={(invoice) => { setSelectedInvoice(invoice); setIsDetailOpen(true); }}
                            />
                        )}

                        {!hasInvoiceExplorerCriteria && (
                            <div className="flex flex-col items-center justify-center py-14 bg-slate-50 rounded-lg border border-dashed border-[#cfdbe7]">
                                <p className="text-[#4c739a] text-base font-normal">Explorador vacío por defecto. Selecciona un cliente o aplica filtros para buscar facturas.</p>
                            </div>
                        )}

                        {hasInvoiceExplorerCriteria && paginatedInvoices.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 bg-slate-50 rounded-lg border border-dashed border-[#cfdbe7]">
                                <p className="text-[#4c739a] text-base font-normal">No se han encontrado facturas que coincidan con los criterios.</p>
                                <button onClick={handleClearFilters} className="mt-4 text-[#4c739a] font-normal text-sm hover:underline uppercase tracking-widest">Limpiar todos los filtros</button>
                            </div>
                        )}

                        {hasInvoiceExplorerCriteria && (
                            <PaginationControls
                                currentPage={currentPage}
                                totalPages={totalPages}
                                pageSize={pageSize}
                                totalItems={totalItems}
                                onPageChange={setCurrentPage}
                                onPageSizeChange={(size) => setPageSize(size)}
                                variant="default"
                            />
                        )}
                    </div>
                </div>
            </div>

            {selectedInvoice && (
                <InvoiceDetailModal
                    isOpen={isDetailOpen}
                    onClose={() => setIsDetailOpen(false)}
                    invoice={selectedInvoice}
                    onUpdate={handleInvoiceUpdated}
                />
            )}

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

export default InvoicesView;
