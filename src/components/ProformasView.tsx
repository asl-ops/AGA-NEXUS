import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FileText, MoreHorizontal, Eye, Trash2, Copy, Ban, X, Edit3, Printer } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import BillingFiltersPanel, { BillingFilters } from './BillingFiltersPanel';
import ProformaDetailModal from './ProformaDetailModal';
import ProformaPDFDocument from './ProformaPDFDocument';
import { Proforma, ProformaStatus } from '../types/billing';
import { useProformas } from '../hooks/useProformas';
import { useToast } from '../hooks/useToast';
import { useCompanySettings } from '../hooks/useCompanySettings';
import { BackToHubButton } from './ui/BackToHubButton';
import { BackToClientNavigationButton } from './ui/BackToClientNavigationButton';
import { PremiumFilterButton } from './ui/PremiumFilterButton';
import { CopyAction } from './ui/ActionFeedback';
import Breadcrumbs from './ui/Breadcrumbs';
import { ColumnSelectorMenu, type ColumnSelectorOption } from './ui/ColumnSelectorMenu';
import { ColumnResizeToggle } from './ui/ColumnResizeToggle';
import { navigateToModule } from '@/utils/moduleNavigation';
import { useConfirmation } from '@/hooks/useConfirmation';
import ConfirmationModal from './ConfirmationModal';
import { getClientNavigationReturnPath, saveClientNavigationContext } from '@/utils/clientNavigationContext';
import { toUiTitleCase } from '@/utils/titleCase';

interface ProformasViewProps {
}

const PROFORMAS_VISIBLE_FIELDS_KEY = 'proformas-visible-fields-v1';
const PROFORMAS_FILTERS_PINNED_KEY = 'proformas-filters-pinned';

const statusLabels: Record<ProformaStatus, { label: string; color: string }> = {
    draft: { label: 'Borrador', color: 'bg-slate-100 text-slate-600' },
    sent: { label: 'Enviada', color: 'bg-blue-100 text-blue-600' },
    accepted: { label: 'Aceptada', color: 'bg-emerald-100 text-emerald-600' },
    rejected: { label: 'Rechazada', color: 'bg-red-100 text-red-600' },
    invoiced: { label: 'Facturada', color: 'bg-indigo-100 text-indigo-600' },
    void: { label: 'Anulada', color: 'bg-slate-200 text-slate-500' }
};

const ProformasView: React.FC<ProformasViewProps> = () => {
    const { subscribeToProformas, deleteProforma } = useProformas();
    const { addToast } = useToast();
    const { company } = useCompanySettings();
    const { confirmationState, confirm, closeConfirmation } = useConfirmation();

    // Data state
    const [proformas, setProformas] = useState<Proforma[]>([]);

    // Filter state
    const [filters, setFilters] = useState<BillingFilters>({
        searchQuery: '',
        clientId: null,
        clientLabel: '',
        caseId: '',
        prefix: '',
        responsibleId: '',
        responsibleLabel: '',
        dateType: 'createdAt',
        startDate: '',
        endDate: '',
        status: 'Todos'
    });

    // Calculate active filter count
    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (filters.clientId) count++;
        if (filters.caseId) count++;
        if (filters.prefix) count++;
        if (filters.responsibleId) count++;
        if (filters.startDate || filters.endDate) count++;
        if (filters.status !== 'Todos') count++;
        return count;
    }, [filters]);

    const handleClearFilters = () => {
        setFilters({
            searchQuery: '',
            clientId: null,
            clientLabel: '',
            caseId: '',
            prefix: '',
            responsibleId: '',
            responsibleLabel: '',
            dateType: 'createdAt',
            startDate: '',
            endDate: '',
            status: 'Todos'
        });
    };

    // UI state
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(() => {
        const saved = localStorage.getItem('proformas-filters-open');
        return saved === 'true';
    });
    const [isFilterPanelPinned, setIsFilterPanelPinned] = useState(() => {
        return localStorage.getItem(PROFORMAS_FILTERS_PINNED_KEY) === 'true';
    });
    const proformasFieldOptions: ColumnSelectorOption[] = [
        { id: 'number', label: 'Número' },
        { id: 'client', label: 'Cliente' },
        { id: 'amount', label: 'Importe' },
        { id: 'status', label: 'Estado' }
    ];
    const [visibleFields, setVisibleFields] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem(PROFORMAS_VISIBLE_FIELDS_KEY);
            if (!raw) return proformasFieldOptions.map(f => f.id);
            const parsed = JSON.parse(raw) as string[];
            const allowed = new Set(proformasFieldOptions.map(f => f.id));
            const filtered = parsed.filter(id => allowed.has(id));
            return filtered.length > 0 ? filtered : proformasFieldOptions.map(f => f.id);
        } catch {
            return proformasFieldOptions.map(f => f.id);
        }
    });
    const visibleFieldsSet = useMemo(() => new Set(visibleFields), [visibleFields]);

    useEffect(() => {
        localStorage.setItem(PROFORMAS_VISIBLE_FIELDS_KEY, JSON.stringify(visibleFields));
    }, [visibleFields]);

    useEffect(() => {
        localStorage.setItem(PROFORMAS_FILTERS_PINNED_KEY, String(isFilterPanelPinned));
    }, [isFilterPanelPinned]);

    const toggleVisibleField = (id: string) => {
        setVisibleFields(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
    };


    // ✅ Cerrar automáticamente el panel de filtros después de inactividad
    useEffect(() => {
        // Solo cerrar si el panel está abierto Y no hay filtros activos
        if (isFilterPanelOpen && activeFilterCount === 0 && !isFilterPanelPinned) {
            // Esperar 5 segundos de inactividad antes de cerrar
            const timer = setTimeout(() => {
                setIsFilterPanelOpen(false);
                localStorage.setItem('proformas-filters-open', 'false');
            }, 5000);

            return () => clearTimeout(timer);
        }
    }, [isFilterPanelOpen, activeFilterCount, isFilterPanelPinned]);

    const [selectedProforma, setSelectedProforma] = useState<Proforma | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Realtime subscription
    useEffect(() => {
        const unsubscribe = subscribeToProformas((data) => {
            setProformas(data);
        });
        return () => unsubscribe();
    }, [subscribeToProformas]);

    // Detect clientId from URL
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.hash.split('?')[1]);
        const clientId = params.get('clientId');
        const identifier = params.get('identifier');
        const clientName = params.get('clientName');
        if (clientId) {
            setSelectedClientId(clientId);
            setFilters(prev => ({
                ...prev,
                clientId,
                clientLabel: clientName || identifier || prev.clientLabel
            }));
            saveClientNavigationContext({
                active: true,
                clientId,
                identifier: identifier || undefined,
                clientName: clientName || undefined,
                sourceModule: 'proformas'
            });
        }
    }, []);

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


    const handleDelete = async (proforma: Proforma) => {
        const confirmed = await confirm({
            title: proforma.status === 'draft' ? 'Eliminar proforma' : 'Anular proforma',
            message: proforma.status === 'draft' ? '¿Eliminar esta proforma?' : '¿Anular esta proforma?',
            description: 'Esta acción aplicará cambios en su estado dentro del módulo de proformas.',
            confirmText: proforma.status === 'draft' ? 'Eliminar' : 'Anular',
            cancelText: 'Cancelar',
            variant: proforma.status === 'draft' ? 'danger' : 'warning'
        });
        if (!confirmed) return;
        await deleteProforma(proforma.id, proforma.status === 'draft');
    };

    const handleProformaUpdated = () => {
        setIsDetailOpen(false);
        setSelectedProforma(null);
    };


    // Filtering in memory
    const filteredProformas = proformas.filter(p => {
        if (filters.clientId && p.clientId !== filters.clientId) return false;
        if (filters.caseId && p.caseNumber && !p.caseNumber.includes(filters.caseId)) return false;
        if (filters.status !== 'Todos') {
            const statusMap: Record<string, ProformaStatus[]> = {
                'Pending': ['draft', 'sent'],
                'Invoiced': ['invoiced'],
                'Void': ['void']
            };
            if (statusMap[filters.status] && !statusMap[filters.status].includes(p.status)) return false;
        }
        return true;
    });

    // Suggestions for filters
    const allCaseIds = useMemo(() => Array.from(new Set(proformas.map(p => p.caseNumber).filter(Boolean) as string[])), [proformas]);
    const allPrefixes = useMemo(() => Array.from(new Set(proformas.map(p => p.caseNumber?.split('-')[0]).filter(Boolean) as string[])), [proformas]);

    return (
        <div className="flex h-full bg-[#fcfdfe] overflow-hidden">
            {/* Filter Panel (LEFT SIDE) */}
            <BillingFiltersPanel
                filters={filters}
                onFilterChange={setFilters}
                onClear={handleClearFilters}
                onClose={() => setIsFilterPanelOpen(false)}
                isOpen={isFilterPanelOpen}
                isPinned={isFilterPanelPinned}
                onTogglePin={() => setIsFilterPanelPinned(prev => !prev)}
                caseIds={allCaseIds}
                prefixes={allPrefixes}
            />

            {/* Main Content */}
            <div className="flex-1 flex flex-col h-full bg-[#fcfdfe] overflow-hidden">
                {/* Header */}
                <div className="bg-white border-b border-slate-200 px-10 py-8 flex-none">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-6">
                            <div className="app-tab app-tab-active cursor-default !py-1 !px-0 !h-auto">
                                Proformas
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
                                isActive={isFilterPanelOpen}
                                onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                                tooltip={`Filtrar proformas${activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}`}
                            />

                                <ColumnSelectorMenu
                                    title="Columnas"
                                    options={proformasFieldOptions}
                                    visibleIds={visibleFields}
                                    onToggle={toggleVisibleField}
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
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8 relative">
                    <div className="max-w-7xl mx-auto">
                        {filteredProformas.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-32 opacity-50">
                                <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                                    <FileText className="w-10 h-10 text-slate-300" />
                                </div>
                                <h3 className="text-lg font-medium text-slate-700">
                                    {proformas.length === 0 ? 'No hay proformas todavía' : 'No hay proformas con estos filtros'}
                                </h3>
                                <p className="text-sm text-slate-500 mt-2 text-center max-w-md">
                                    {proformas.length === 0
                                        ? 'Crea tu primera proforma pulsando "Nueva Proforma".'
                                        : 'Prueba a limpiar los filtros.'
                                    }
                                </p>
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="divide-y divide-slate-100">
                                    {filteredProformas.map(proforma => {
                                        const statusInfo = statusLabels[proforma.status];
                                        return (
                                            <div
                                                key={proforma.id}
                                                className="p-4 flex items-center gap-6 group hover:bg-slate-50 transition-colors cursor-pointer"
                                                onDoubleClick={() => { setSelectedProforma(proforma); setIsDetailOpen(true); }}
                                            >
                                                {/* Icon */}
                                                <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                                                    <FileText size={18} strokeWidth={2.5} />
                                                </div>

                                                {/* Details */}
                                                <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                                                    {visibleFieldsSet.has('number') && <div>
                                                        <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">
                                                            Número
                                                        </div>
                                                        <div className="font-medium text-slate-700 flex items-center gap-2">
                                                            {proforma.number ? (
                                                                <CopyAction text={proforma.number}>
                                                                    <div className="flex items-center gap-2 group/copy">
                                                                        <span className="font-mono">{proforma.number}</span>
                                                                        <div className="p-1 text-slate-300 group-hover/copy:text-sky-500 transition-colors">
                                                                            <Copy size={12} />
                                                                        </div>
                                                                    </div>
                                                                </CopyAction>
                                                            ) : (
                                                                <span className="text-slate-400 italic">Borrador</span>
                                                            )}
                                                        </div>
                                                    </div>}
                                                    {visibleFieldsSet.has('client') && <div>
                                                        <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Cliente</div>
                                                        <div className="text-slate-600 text-sm">
                                                            {toUiTitleCase(proforma.clientName) || <span className="italic text-slate-400">Sin cliente</span>}
                                                        </div>
                                                    </div>}
                                                    {visibleFieldsSet.has('amount') && <div>
                                                        <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Importe</div>
                                                        <div className="font-normal text-slate-700 flex items-center gap-1">
                                                            {proforma.total.toLocaleString('es-ES', { minimumFractionDigits: 2 })}
                                                            <span className="text-[10px] text-slate-400">EUR</span>
                                                        </div>
                                                    </div>}
                                                    {visibleFieldsSet.has('status') && <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusInfo.color}`}>
                                                            {statusInfo.label}
                                                        </span>
                                                    </div>}
                                                </div>

                                                {/* Actions - Menu ⋯ */}
                                                <div className="relative">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (openMenuId === proforma.id) {
                                                                setOpenMenuId(null);
                                                                setMenuPos(null);
                                                            } else {
                                                                const rect = e.currentTarget.getBoundingClientRect();
                                                                let top = rect.bottom + 6;
                                                                let left = rect.right - 192;
                                                                if (left < 16) left = 16;
                                                                if (top + 200 > window.innerHeight) top = rect.top - 200;
                                                                setMenuPos({ top, left });
                                                                setOpenMenuId(proforma.id);
                                                            }
                                                        }}
                                                        className={`p-2 rounded-lg transition-all duration-150 ${openMenuId === proforma.id ? 'bg-slate-200 text-slate-700 opacity-100' : 'text-slate-400 opacity-50 hover:opacity-100 hover:bg-slate-100'}`}
                                                    >
                                                        <MoreHorizontal className="w-4 h-4" />
                                                    </button>

                                                    {openMenuId === proforma.id && menuPos && (
                                                        <div
                                                            ref={menuRef}
                                                            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
                                                            className="w-48 bg-white border border-slate-200 rounded-lg shadow-xl z-[9999] py-1"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <button
                                                                onClick={() => { setSelectedProforma(proforma); setIsDetailOpen(true); setOpenMenuId(null); setMenuPos(null); }}
                                                                className="w-full text-left px-3 py-2 text-xs font-normal text-slate-600 hover:bg-slate-50 hover:text-indigo-600 flex items-center gap-2"
                                                            >
                                                                <Eye className="w-3.5 h-3.5" /> Vista Previa
                                                            </button>
                                                            <button
                                                                onClick={() => { setSelectedProforma(proforma); setIsDetailOpen(true); setOpenMenuId(null); setMenuPos(null); }}
                                                                className="w-full text-left px-3 py-2 text-xs font-normal text-slate-600 hover:bg-slate-50 hover:text-sky-600 flex items-center gap-2"
                                                            >
                                                                <Edit3 className="w-3.5 h-3.5" /> Editar
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    setOpenMenuId(null); setMenuPos(null);
                                                                    const blob = await pdf(<ProformaPDFDocument proforma={proforma} company={company} />).toBlob();
                                                                    const url = URL.createObjectURL(blob);
                                                                    const link = document.createElement('a');
                                                                    link.href = url;
                                                                    link.download = `proforma-${proforma.number || proforma.id.slice(0, 8)}.pdf`;
                                                                    link.click();
                                                                    URL.revokeObjectURL(url);
                                                                    addToast('PDF descargado', 'success');
                                                                }}
                                                                className="w-full text-left px-3 py-2 text-xs font-normal text-slate-600 hover:bg-slate-50 hover:text-amber-600 flex items-center gap-2"
                                                            >
                                                                <Printer className="w-3.5 h-3.5" /> Imprimir
                                                            </button>
                                                            <div className="h-px bg-slate-100 my-1" />
                                                            <button
                                                                onClick={() => { handleDelete(proforma); setOpenMenuId(null); setMenuPos(null); }}
                                                                className="w-full text-left px-3 py-2 text-xs font-normal text-red-500 hover:bg-red-50 flex items-center gap-2"
                                                            >
                                                                {proforma.status === 'draft' ? (
                                                                    <><Trash2 className="w-3.5 h-3.5" /> Eliminar</>
                                                                ) : (
                                                                    <><Ban className="w-3.5 h-3.5" /> Anular</>
                                                                )}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Detail Modal */}
            {selectedProforma && (
                <ProformaDetailModal
                    isOpen={isDetailOpen}
                    onClose={() => setIsDetailOpen(false)}
                    proforma={selectedProforma}
                    onUpdate={handleProformaUpdated}
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

export default ProformasView;
