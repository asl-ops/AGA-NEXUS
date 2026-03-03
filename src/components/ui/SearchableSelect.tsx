
import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check, Loader2, X } from 'lucide-react';

export interface SelectOption {
    id: string;
    label: string;
    description?: string;
    subLabel?: string;
    searchValue?: string; // Additional text to search against
}

interface SearchableSelectProps {
    options: SelectOption[];
    value?: string;
    onChange: (id: string) => void;
    placeholder?: string;
    label?: string;
    disabled?: boolean;
    loading?: boolean;
    className?: string;
    error?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
    options,
    value,
    onChange,
    placeholder = 'Seleccionar...',
    label,
    disabled = false,
    loading = false,
    className = '',
    error
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(opt => opt.id === value);

    const filteredOptions = options.filter(opt => {
        const searchLower = String(search || '').toLowerCase();
        const label = String(opt.label || '').toLowerCase();
        const description = String(opt.description || '').toLowerCase();
        const subLabel = String(opt.subLabel || '').toLowerCase();
        const searchValue = String(opt.searchValue || '').toLowerCase();
        return (
            label.includes(searchLower) ||
            description.includes(searchLower) ||
            subLabel.includes(searchLower) ||
            searchValue.includes(searchLower)
        );
    });

    const handleToggle = () => {
        if (disabled) return;
        setIsOpen(!isOpen);
        if (!isOpen) {
            setSearch('');
            setHighlightedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    };

    const handleSelect = (option: SelectOption) => {
        onChange(option.id);
        setIsOpen(false);
        setSearch('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
                handleToggle();
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightedIndex(prev => (prev + 1) % filteredOptions.length);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightedIndex(prev => (prev - 1 + filteredOptions.length) % filteredOptions.length);
                break;
            case 'Enter':
                e.preventDefault();
                if (filteredOptions[highlightedIndex]) {
                    handleSelect(filteredOptions[highlightedIndex]);
                }
                break;
            case 'Escape':
                setIsOpen(false);
                break;
        }
    };

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Sync highlighted index with filter
    useEffect(() => {
        setHighlightedIndex(0);
    }, [search]);

    // Scroll highlighted item into view
    useEffect(() => {
        if (isOpen && listRef.current) {
            const highlightedItem = listRef.current.children[highlightedIndex] as HTMLElement;
            if (highlightedItem) {
                highlightedItem.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [highlightedIndex, isOpen]);

    return (
        <div className={`relative w-full ${className}`} ref={containerRef}>
            {label && (
                <label className="block text-[13px] font-medium text-slate-700 mb-1.5 ml-1">
                    {label}
                </label>
            )}

            <div
                onClick={handleToggle}
                className={`
                    w-full h-11 px-4 bg-slate-50 border rounded-xl flex items-center justify-between cursor-pointer transition-all
                    ${isOpen ? 'bg-white ring-4 ring-sky-500/10 border-sky-500 shadow-sm' : 'hover:border-slate-300 border-slate-200'}
                    ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-100' : ''}
                    ${error ? 'border-rose-400 ring-rose-500/10' : ''}
                `}
                onKeyDown={handleKeyDown}
                tabIndex={disabled ? -1 : 0}
            >
                <div className="truncate flex-1">
                    {selectedOption ? (
                        <div className="flex flex-col text-left">
                            <span className="text-sm text-slate-700 font-medium truncate">{selectedOption.label}</span>
                            {selectedOption.subLabel && (
                                <span className="text-[10px] text-slate-500 truncate -mt-0.5">{selectedOption.subLabel}</span>
                            )}
                        </div>
                    ) : (
                        <span className="text-sm text-slate-400">{placeholder}</span>
                    )}
                </div>
                {loading ? (
                    <Loader2 className="w-4 h-4 text-sky-500 animate-spin" />
                ) : (
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                )}
            </div>

            {isOpen && (
                <div className="absolute top-[calc(100%+4px)] left-0 w-full bg-white border border-slate-200 rounded-xl shadow-xl z-[110] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="p-2 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                        <Search className="w-4 h-4 text-slate-400 ml-2" />
                        <input
                            ref={inputRef}
                            type="text"
                            placeholder="Buscar..."
                            className="w-full h-8 bg-transparent border-none outline-none text-sm text-slate-700 placeholder:text-slate-400"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                            <button onClick={() => setSearch('')} className="p-1 hover:bg-slate-200 rounded-full transition-colors mr-1">
                                <X className="w-3 h-3 text-slate-400" />
                            </button>
                        )}
                    </div>

                    <div ref={listRef} className="max-h-[240px] overflow-y-auto overflow-x-hidden py-1">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((opt, idx) => (
                                <div
                                    key={opt.id}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleSelect(opt);
                                    }}
                                    onMouseEnter={() => setHighlightedIndex(idx)}
                                    className={`
                                        px-4 py-2.5 cursor-pointer flex items-center justify-between gap-3 transition-colors
                                        ${idx === highlightedIndex ? 'bg-sky-50 text-sky-700' : 'text-slate-700 hover:bg-slate-50'}
                                        ${opt.id === value ? 'bg-sky-50/50' : ''}
                                    `}
                                >
                                    <div className="flex flex-col min-w-0">
                                        <div className="flex items-baseline gap-2">
                                            <span className={`text-sm font-medium truncate ${idx === highlightedIndex ? 'text-sky-700' : 'text-slate-700'}`}>
                                                {opt.label}
                                            </span>
                                            {opt.description && (
                                                <span className="text-[11px] text-slate-400 truncate font-normal">{opt.description}</span>
                                            )}
                                        </div>
                                        {opt.subLabel && (
                                            <span className="text-[10px] text-slate-500/70 truncate uppercase tracking-tight">{opt.subLabel}</span>
                                        )}
                                    </div>
                                    {opt.id === value && <Check className="w-4 h-4 text-sky-600 shrink-0" />}
                                </div>
                            ))
                        ) : (
                            <div className="px-4 py-8 text-center">
                                <Search className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                                <p className="text-xs text-slate-400">No se encontraron resultados</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {error && (
                <p className="mt-1 ml-1 text-[11px] text-rose-500 font-medium">{error}</p>
            )}
        </div>
    );
};

export default SearchableSelect;
