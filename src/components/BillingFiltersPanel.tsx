import React, { useState, useEffect } from 'react';
import {
    Filter,
    RotateCcw,
    Search,
    X,
    Hash,
    Briefcase,
    User as UserIcon,
    Activity,
    Pin
} from 'lucide-react';
import { ClientTypeahead } from './ClientTypeahead';
import SmartDatePicker from './ui/SmartDatePicker';
import { useAppContext } from '../contexts/AppContext';

interface Suggestion {
    id: string;
    label: string;
    sublabel?: string;
}

export interface BillingFilters {
    searchQuery: string; // Not used directly if we use structured inputs, but good for general search
    clientId: string | null;
    clientLabel: string;
    caseId: string; // Expediente / Albarán
    prefix: string;
    ejercicio?: string;
    responsibleId: string;
    responsibleLabel: string;
    dateType: 'createdAt' | 'closedAt';
    startDate: string;
    endDate: string;
    status: string; // 'Todos' | 'Pendientes' | 'Cobradas'
}

interface BillingFiltersPanelProps {
    filters: BillingFilters;
    onFilterChange: (newFilters: BillingFilters) => void;
    onClear: () => void;
    onClose: () => void;
    isOpen: boolean;
    // Arrays for suggestions
    caseIds?: string[];
    prefixes?: string[];
    showEjercicio?: boolean;
    showCaseFilter?: boolean;
    showPrefixFilter?: boolean;
    showResponsibleFilter?: boolean;
    showStatusFilter?: boolean;
    isPinned?: boolean;
    onTogglePin?: () => void;
}

// Reusing PredictiveInput directly here for self-containment or could be extracted
const PredictiveInput: React.FC<{
    label: string;
    value: string;
    onChange: (id: string, label: string) => void;
    suggestions: Suggestion[];
    placeholder: string;
    icon?: React.ReactNode;
    displayValue: string;
}> = ({ label, onChange, suggestions, placeholder, icon, displayValue }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [inputValue, setInputValue] = useState(displayValue || '');
    const [_highlightedIndex, _setHighlightedIndex] = React.useState(-1);
    const containerRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        setInputValue(displayValue || '');
    }, [displayValue]);

    const lowerInput = (inputValue || '').toLowerCase();
    const filteredSuggestions = suggestions
        .filter(s => {
            const suggestionLabel = String((s as any)?.label ?? '').toLowerCase();
            const suggestionSubLabel = String((s as any)?.sublabel ?? '').toLowerCase();
            return suggestionLabel.includes(lowerInput) || suggestionSubLabel.includes(lowerInput);
        })
        .slice(0, 5);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="flex flex-col gap-2 relative" ref={containerRef}>
            <label className="app-label-block px-1">{label}</label>
            <div className="relative">
                <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => {
                        setInputValue(e.target.value);
                        setIsOpen(true);
                        onChange(e.target.value, e.target.value); // Update parent immediately for non-strict selection
                    }}
                    onFocus={() => setIsOpen(true)}
                    placeholder={placeholder}
                    className="w-full pl-11 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm font-normal text-slate-700 bg-slate-50 shadow-sm focus:bg-white focus:ring-4 focus:ring-sky-500/10 focus:border-sky-500 outline-none transition-all"
                />
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                    {icon || <Search className="w-4 h-4" />}
                </div>
                {inputValue && (
                    <button onClick={() => {
                        onChange('', '');
                        setInputValue('');
                    }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {isOpen && filteredSuggestions.length > 0 && (
                <ul className="absolute z-[100] top-[80px] left-0 right-0 bg-white border border-slate-100 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    {filteredSuggestions.map((s, i) => (
                        <li
                            key={s.id}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                onChange(s.id, s.label);
                                setIsOpen(false);
                            }}
                            className={`px-5 py-4 cursor-pointer transition-colors border-b border-slate-50 last:border-b-0 ${i === _highlightedIndex ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
                        >
                            <div className="text-sm font-normal text-slate-800 uppercase tracking-tight">{s.label}</div>
                            {s.sublabel && (
                                <div className="app-muted !text-[9px] !uppercase mt-1">{s.sublabel}</div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

const BillingFiltersPanel: React.FC<BillingFiltersPanelProps> = ({
    filters,
    onFilterChange,
    onClear,
    onClose,
    isOpen,
    caseIds = [],
    prefixes = [],
    showEjercicio = false,
    showCaseFilter = true,
    showPrefixFilter = true,
    showResponsibleFilter = true,
    showStatusFilter = true,
    isPinned = false,
    onTogglePin
}) => {
    const { users } = useAppContext();

    const hasActiveFilters =
        filters.clientId ||
        (showCaseFilter && filters.caseId) ||
        (showPrefixFilter && filters.prefix) ||
        filters.ejercicio ||
        (showResponsibleFilter && filters.responsibleId) ||
        filters.startDate ||
        filters.endDate ||
        (showStatusFilter && filters.status !== 'Todos');

    const userSuggestions: Suggestion[] = users.map(u => ({
        id: u.id,
        label: u.name,
        sublabel: u.id.startsWith('user-') ? 'Gestor' : 'Responsable'
    }));

    const caseSuggestions: Suggestion[] = caseIds.map(id => ({ id, label: id }));
    const prefixSuggestions: Suggestion[] = prefixes.map(p => ({ id: p, label: p }));

    const updateFilter = (key: keyof BillingFilters, value: any) => {
        onFilterChange({ ...filters, [key]: value });
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Mobile overlay backdrop */}
            <div
                className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden animate-in fade-in duration-200"
                onClick={onClose}
            />

            {/* Filter Panel */}
            <div className={`
                flex flex-col h-full bg-white font-sans overflow-hidden border-r border-slate-100 shrink-0
                w-80 transition-all duration-300 ease-in-out
                fixed lg:relative inset-y-0 left-0 z-50 lg:z-auto
                ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
            `}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-8 pb-4 border-b border-slate-50">
                    <div className="flex items-center gap-2">
                        <Filter className="w-5 h-5 text-sky-600" />
                        <h2 className="app-section-title !mb-0 !text-[13px]">FILTROS</h2>
                    </div>
                    <div className="flex items-center gap-1">
                        {hasActiveFilters && (
                            <button
                                onClick={onClear}
                                className="app-muted hover:text-sky-600 transition-colors flex items-center gap-1 text-xs"
                                title="Limpiar todos los filtros"
                            >
                                <RotateCcw className="w-3 h-3" /> Limpiar
                            </button>
                        )}
                        {onTogglePin && (
                            <button
                                onClick={onTogglePin}
                                className={`p-1.5 rounded-lg transition-colors ${isPinned
                                    ? 'text-sky-600 bg-sky-50 hover:bg-sky-100'
                                    : 'text-slate-300 hover:text-slate-500 hover:bg-slate-50'
                                    }`}
                                title={isPinned ? 'Desfijar panel de filtros' : 'Fijar panel de filtros'}
                                aria-label={isPinned ? 'Desfijar panel de filtros' : 'Fijar panel de filtros'}
                            >
                                <Pin className={`w-4 h-4 ${isPinned ? 'fill-sky-600' : ''}`} />
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1.5 text-slate-300 hover:text-slate-500 hover:bg-slate-50 rounded-lg transition-colors ml-2"
                            title="Cerrar filtros"
                            aria-label="Cerrar filtros"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6 no-scrollbar">

                    {/* Client Search */}
                    <div className="flex flex-col gap-2">
                        <label className="app-label-block px-1">Cliente</label>
                        <div className="[&_input]:h-12 [&_input]:rounded-lg [&_input]:border-[#cfdbe7] [&_input]:bg-slate-50 [&_input]:text-base [&_input]:font-normal [&_input]:pl-10">
                            <ClientTypeahead
                                valueClientId={filters.clientId}
                                valueLabel={filters.clientLabel}
                                placeholder="DNI, NIF, Nombre..."
                                onSelect={(client) => {
                                    onFilterChange({
                                        ...filters,
                                        clientId: client.id,
                                        clientLabel: `${client.documento ? client.documento + ' — ' : ''}${client.nombre}`
                                    });
                                }}
                                onClear={() => {
                                    onFilterChange({ ...filters, clientId: null, clientLabel: '' });
                                }}
                                enableQuickCreate={false}
                                limit={5}
                            />
                        </div>
                    </div>

                    {showCaseFilter && (
                        <PredictiveInput
                            label="Nº Expediente / Albarán"
                            value={filters.caseId}
                            displayValue={filters.caseId}
                            onChange={(id) => updateFilter('caseId', id)}
                            suggestions={caseSuggestions}
                            placeholder="EXP-00..."
                            icon={<Hash className="w-5 h-5" />}
                        />
                    )}

                    {showPrefixFilter && (
                        <PredictiveInput
                            label="Prefijo"
                            value={filters.prefix}
                            displayValue={filters.prefix}
                            onChange={(id) => updateFilter('prefix', id)}
                            suggestions={prefixSuggestions}
                            placeholder="EXP, GE..."
                            icon={<Briefcase className="w-5 h-5" />}
                        />
                    )}

                    {showEjercicio && (
                        <div className="flex flex-col gap-2">
                            <label className="app-label-block px-1">Ejercicio</label>
                            <div className="relative">
                                <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                <input
                                    type="text"
                                    value={filters.ejercicio || ''}
                                    onChange={(e) => {
                                        const year = e.target.value.replace(/\D/g, '').slice(0, 4);
                                        updateFilter('ejercicio', year || undefined);
                                    }}
                                    placeholder="AAAA"
                                    maxLength={4}
                                    inputMode="numeric"
                                    className="w-full pl-11 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm font-normal text-slate-700 bg-slate-50 shadow-sm focus:bg-white focus:ring-4 focus:ring-sky-500/10 focus:border-sky-500 outline-none transition-all"
                                />
                            </div>
                        </div>
                    )}

                    {showResponsibleFilter && (
                        <PredictiveInput
                            label="Responsable"
                            value={filters.responsibleId}
                            displayValue={filters.responsibleLabel}
                            onChange={(id, label) => {
                                onFilterChange({ ...filters, responsibleId: id, responsibleLabel: label });
                            }}
                            suggestions={userSuggestions}
                            placeholder="Buscar responsable..."
                            icon={<UserIcon className="w-5 h-5" />}
                        />
                    )}

                    <div className="border-t border-slate-50 pt-6">
                        <h3 className="app-title mb-4 ml-1">Periodo y Estado</h3>


                        {/* Dates */}
                        <div className="space-y-4">
                            <SmartDatePicker
                                label="Fecha desde"
                                value={filters.startDate}
                                onChange={(val) => updateFilter('startDate', val)}
                            />
                            <SmartDatePicker
                                label="Fecha hasta"
                                value={filters.endDate}
                                onChange={(val) => updateFilter('endDate', val)}
                            />
                        </div>

                        {showStatusFilter && (
                            <div className="flex flex-col gap-2 mt-6">
                                <label className="app-label-block px-1">Estado Facturas</label>
                                <div className="relative">
                                    <select
                                        value={filters.status}
                                        onChange={(e) => updateFilter('status', e.target.value)}
                                        className="w-full bg-slate-50 border border-[#cfdbe7] rounded-lg h-12 pl-4 pr-10 text-base font-normal text-[#0d141b] appearance-none focus:ring-2 focus:ring-[#1380ec]/20 outline-none transition-all"
                                    >
                                        <option value="Todos">Todos</option>
                                        <option value="Pendientes">Pendientes</option>
                                        <option value="Cobradas">Cobradas</option>
                                    </select>
                                    <Activity className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div className="h-8 bg-gradient-to-t from-white to-transparent pointer-events-none" />
            </div>
        </>
    );
};

export default BillingFiltersPanel;
