import React, { useState, useRef, useEffect } from 'react';
import {
    Search,
    X,
    Filter,
    Briefcase,
    Activity,
    Hash,
    ChevronDown,
    RotateCcw,
    User as UserIcon,
    PanelLeftClose,
    PanelLeftOpen
} from 'lucide-react';
import { PrefixConfig, CaseRecord } from '../types';
import { ClientTypeahead } from './ClientTypeahead';
import { useAppContext } from '../contexts/AppContext';
import SmartDatePicker from './ui/SmartDatePicker';

interface Suggestion {
    id: string;
    label: string;
    sublabel?: string;
}

interface FilterPanelProps {
    searchQuery: string;
    setSearchQuery: (value: string) => void;
    selectedClientId: string | null;
    setSelectedClientId: (value: string | null) => void;
    selectedClientLabel: string;
    setSelectedClientLabel: (value: string) => void;
    identifierFilter: string;
    setIdentifierFilter: (value: string) => void;
    prefixFilter: string;
    setPrefixFilter: (value: string) => void;
    statusFilter: string;
    setStatusFilter: (value: string) => void;
    categoryFilter: string;
    setCategoryFilter: (value: string) => void;
    situationFilter: string;
    setSituationFilter: (value: string) => void;
    responsibleFilter: string;
    setResponsibleFilter: (value: string) => void;
    responsibleLabel: string;
    setResponsibleLabel: (value: string) => void;
    dateFilterType: 'createdAt' | 'closedAt';
    setDateFilterType: (value: 'createdAt' | 'closedAt') => void;
    startDate: string;
    setStartDate: (value: string) => void;
    endDate: string;
    setEndDate: (value: string) => void;
    prefixes: PrefixConfig[];
    caseStatuses: string[];
    onClearFilters: () => void;
    allCases?: CaseRecord[];
    // Collapse support
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}

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
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);

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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown') setIsOpen(true);
            return;
        }

        if (e.key === 'ArrowDown') {
            setHighlightedIndex(prev => (prev + 1) % filteredSuggestions.length);
        } else if (e.key === 'ArrowUp') {
            setHighlightedIndex(prev => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
        } else if (e.key === 'Enter') {
            if (highlightedIndex >= 0) {
                const suggestion = filteredSuggestions[highlightedIndex];
                onChange(suggestion.id, suggestion.label);
                setIsOpen(false);
                setHighlightedIndex(-1);
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false);
        }
    };

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
                    }}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
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
                            className={`px-5 py-4 cursor-pointer transition-colors border-b border-slate-50 last:border-b-0 ${i === highlightedIndex ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
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

const FilterPanel: React.FC<FilterPanelProps> = ({
    searchQuery,
    setSearchQuery,
    selectedClientId,
    setSelectedClientId,
    selectedClientLabel,
    setSelectedClientLabel,
    identifierFilter,
    setIdentifierFilter,
    prefixFilter,
    setPrefixFilter,
    statusFilter,
    setStatusFilter,
    situationFilter,
    setSituationFilter,
    dateFilterType,
    setDateFilterType,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    responsibleFilter,
    setResponsibleFilter,
    responsibleLabel,
    setResponsibleLabel,
    prefixes,
    caseStatuses,
    onClearFilters,
    allCases = [],
    isCollapsed = false,
    onToggleCollapse
}) => {
    const { users } = useAppContext();
    const hasActiveFilters =
        searchQuery ||
        selectedClientId ||
        identifierFilter ||
        prefixFilter ||
        responsibleFilter ||
        statusFilter !== 'Todos' ||
        situationFilter !== 'Todos' ||
        startDate ||
        endDate;

    const caseSuggestions: Suggestion[] = Array.from(new Set(allCases.map(c => c.fileNumber)))
        .filter(Boolean)
        .map(id => ({ id, label: id }));

    const prefixSuggestions: Suggestion[] = Array.from(new Set([...prefixes.map(p => p.id), ...allCases.map(c => c.fileNumber.split('-')[0])]))
        .filter(Boolean)
        .map(p => ({ id: p, label: p }));

    const userSuggestions: Suggestion[] = users.map(u => ({
        id: u.id,
        label: u.name,
        sublabel: u.id.startsWith('user-') ? 'Gestor' : 'Responsable'
    }));

    // Collapsed State
    if (isCollapsed) {
        return (
            <div className="flex flex-col items-center py-6 px-2 bg-white border-r border-slate-100 h-full w-12 transition-[width] duration-200 ease-in-out">
                <button
                    onClick={onToggleCollapse}
                    className="p-2 text-slate-400 hover:text-sky-600 hover:bg-slate-50 rounded-lg transition-colors"
                    title="Expandir filtros"
                    aria-label="Expandir filtros"
                    aria-expanded="false"
                >
                    <PanelLeftOpen className="w-5 h-5" />
                </button>
                <div className="mt-4 text-slate-300 relative" title={hasActiveFilters ? "Hay filtros aplicados" : undefined}>
                    <Filter className="w-4 h-4" />
                    {hasActiveFilters && (
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-sky-500 rounded-full" />
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white font-sans overflow-hidden w-80 transition-[width] duration-200 ease-in-out">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-8 pb-4 border-b border-slate-50">
                <div className="flex items-center gap-2">
                    <Filter className="w-5 h-5 text-sky-600" />
                    <h2 className="app-section-title !mb-0 !text-[13px]">Filtros</h2>
                </div>
                <div className="flex items-center gap-1">
                    {hasActiveFilters && (
                        <button
                            onClick={onClearFilters}
                            className="app-muted hover:text-sky-600 transition-colors flex items-center gap-1"
                        >
                            <RotateCcw className="w-3 h-3" /> Limpiar
                        </button>
                    )}
                    {onToggleCollapse && (
                        <button
                            onClick={onToggleCollapse}
                            className="p-1.5 text-slate-300 hover:text-slate-500 hover:bg-slate-50 rounded-lg transition-colors ml-2"
                            title="Ocultar filtros"
                            aria-label="Ocultar filtros"
                            aria-expanded="true"
                        >
                            <PanelLeftClose className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6 no-scrollbar">

                {/* 1. Cliente (predictivo) */}
                <div className="flex flex-col gap-2">
                    <label className="app-label-block px-1">Cliente</label>
                    <div className="[&_input]:h-12 [&_input]:rounded-lg [&_input]:border-[#cfdbe7] [&_input]:bg-slate-50 [&_input]:text-base [&_input]:font-normal [&_input]:pl-10">
                        <ClientTypeahead
                            valueClientId={selectedClientId}
                            valueLabel={selectedClientLabel}
                            placeholder="DNI, NIF, Nombre..."
                            onSelect={(client) => {
                                setSelectedClientId(client.id);
                                setSelectedClientLabel(`${client.documento ? client.documento + ' — ' : ''}${client.nombre}`);
                                setSearchQuery('');
                            }}
                            onClear={() => {
                                setSelectedClientId(null);
                                setSelectedClientLabel('');
                            }}
                            enableQuickCreate={false}
                            limit={10}
                        />
                    </div>
                </div>

                {/* 2. Expediente (predictivo) */}
                <PredictiveInput
                    label="Nº Expediente"
                    value={identifierFilter}
                    displayValue={identifierFilter}
                    onChange={(id) => setIdentifierFilter(id)}
                    suggestions={caseSuggestions}
                    placeholder="EXP-0000"
                    icon={<Hash className="w-5 h-5" />}
                />

                {/* 3. Prefijo (predictivo) */}
                <PredictiveInput
                    label="Prefijo de Expediente"
                    value={prefixFilter}
                    displayValue={prefixFilter}
                    onChange={(id) => setPrefixFilter(id)}
                    suggestions={prefixSuggestions}
                    placeholder="EXP, GEMAT..."
                    icon={<Briefcase className="w-5 h-5" />}
                />

                {/* 4. Responsable (predictivo) */}
                <PredictiveInput
                    label="Responsable"
                    value={responsibleFilter}
                    displayValue={responsibleLabel}
                    onChange={(id, label) => {
                        setResponsibleFilter(id);
                        setResponsibleLabel(label);
                    }}
                    suggestions={userSuggestions}
                    placeholder="Buscar responsable..."
                    icon={<UserIcon className="w-5 h-5" />}
                />

                <div className="border-t border-slate-50 pt-6">
                    <h3 className="app-title mb-4 ml-1">Periodo y Situación</h3>

                    {/* 4. Tipo de Fecha */}
                    <div className="flex flex-col gap-2 mb-4">
                        <label className="app-label-block px-1">Tipo de Fecha</label>
                        <div className="relative">
                            <select
                                value={dateFilterType}
                                onChange={(e) => setDateFilterType(e.target.value as 'createdAt' | 'closedAt')}
                                className="w-full bg-slate-50 border border-[#cfdbe7] rounded-lg h-12 pl-4 pr-10 text-base font-normal text-[#0d141b] appearance-none focus:ring-2 focus:ring-[#1380ec]/20 outline-none transition-all"
                            >
                                <option value="createdAt">Fecha de Apertura</option>
                                <option value="closedAt">Fecha de Cierre</option>
                            </select>
                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    {/* 5. Fecha Desde y Hasta */}
                    <div className="space-y-4">
                        <SmartDatePicker
                            label="Desde"
                            value={startDate}
                            onChange={setStartDate}
                        />
                        <SmartDatePicker
                            label="Hasta"
                            value={endDate}
                            onChange={setEndDate}
                        />
                    </div>
                </div>

                <div className="border-t border-slate-50 pt-6">
                    {/* Situación */}
                    <div className="flex flex-col gap-2 mb-6">
                        <label className="app-label-block px-1">Situación</label>
                        <div className="relative">
                            <select
                                value={situationFilter}
                                onChange={(e) => setSituationFilter(e.target.value)}
                                className="w-full bg-slate-50 border border-[#cfdbe7] rounded-lg h-12 pl-4 pr-10 text-base font-normal text-[#0d141b] appearance-none focus:ring-2 focus:ring-[#1380ec]/20 outline-none transition-all"
                            >
                                <option value="Todos">Cualquier Situación</option>
                                <option value="Iniciado">Iniciado</option>
                                <option value="En Proceso">En Proceso</option>
                                <option value="Detenido">Detenido</option>
                                <option value="Cerrado">Cerrado</option>
                                <option value="Finalizado">Finalizado</option>
                            </select>
                            <Activity className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    {/* Estado */}
                    <div className="flex flex-col gap-2">
                        <label className="app-label-block px-1">Estado de Tramitación</label>
                        <div className="relative">
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="w-full bg-slate-50 border border-[#cfdbe7] rounded-lg h-12 pl-4 pr-10 text-base font-normal text-[#0d141b] appearance-none focus:ring-2 focus:ring-[#1380ec]/20 outline-none transition-all"
                            >
                                <option value="Todos">Todos los Estados</option>
                                {caseStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <Activity className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer shadow fade */}
            <div className="h-8 bg-gradient-to-t from-white to-transparent pointer-events-none" />
        </div>
    );
};

export default FilterPanel;
