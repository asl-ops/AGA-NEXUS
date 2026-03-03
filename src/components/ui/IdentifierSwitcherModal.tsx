import React from 'react';
import { Search, Pin, X, Copy } from 'lucide-react';
import { useAppContext } from '@/contexts/AppContext';
import {
    normalizeRecentClientIdentifier,
    pushRecentClientIdentifier,
    readRecentClientIdentifiers,
    readIsIdentifierPinned,
    setActiveClientIdentifier,
    setPinnedClientIdentifier,
    type RecentClientIdentifierEntry,
} from '@/utils/recentClientIdentifiers';

type IdentifierSwitcherMode = 'auto' | 'active' | 'pinned';

interface IdentifierSwitcherModalProps {
    isOpen: boolean;
    mode?: IdentifierSwitcherMode;
    onClose: () => void;
}

const isValidIdentifier = (value: string): boolean => {
    const normalized = normalizeRecentClientIdentifier(value);
    if (!normalized) return false;
    if (normalized.length < 3) return false;
    return /^[A-Z0-9]+$/.test(normalized);
};

export const IdentifierSwitcherModal: React.FC<IdentifierSwitcherModalProps> = ({
    isOpen,
    mode = 'auto',
    onClose,
}) => {
    const { currentUser, savedClients } = useAppContext();
    const [query, setQuery] = React.useState('');
    const [recents, setRecents] = React.useState<RecentClientIdentifierEntry[]>([]);
    const [highlightIndex, setHighlightIndex] = React.useState(0);
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    const hydratedRecents = React.useCallback(() => {
        const list = readRecentClientIdentifiers(currentUser?.id, 50);
        return list.map(entry => {
            if (entry.displayName) return entry;
            const match = savedClients.find(client =>
                normalizeRecentClientIdentifier(client.documento) === entry.identifier ||
                normalizeRecentClientIdentifier(client.nif) === entry.identifier
            );
            return {
                identifier: entry.identifier,
                displayName: match?.nombre || match?.legalName || '',
            };
        });
    }, [currentUser?.id, savedClients]);

    React.useEffect(() => {
        if (!isOpen) return;
        setRecents(hydratedRecents());
        setQuery('');
        setHighlightIndex(0);
        const t = window.setTimeout(() => inputRef.current?.focus(), 10);
        return () => window.clearTimeout(t);
    }, [isOpen, hydratedRecents]);

    const results = React.useMemo(() => {
        const normalized = normalizeRecentClientIdentifier(query);
        if (!normalized || normalized.length < 2) return recents.slice(0, 20);

        const recentMatches = recents.filter(entry =>
            entry.identifier.startsWith(normalized) ||
            (entry.displayName || '').toUpperCase().includes(normalized)
        );

        const clientMatches = savedClients
            .map(client => {
                const identifier = normalizeRecentClientIdentifier(client.documento || client.nif || '');
                if (!identifier) return null;
                const displayName = client.nombre || client.legalName || '';
                const idMatch = identifier.startsWith(normalized);
                const nameMatch = displayName.toUpperCase().includes(normalized);
                if (!idMatch && !nameMatch) return null;
                return { identifier, displayName };
            })
            .filter((entry): entry is RecentClientIdentifierEntry => !!entry);

        const merged = [...recentMatches, ...clientMatches].filter(
            (entry, index, arr) => arr.findIndex(x => x.identifier === entry.identifier) === index
        );
        return merged.slice(0, 20);
    }, [query, recents, savedClients]);

    React.useEffect(() => {
        setHighlightIndex(0);
    }, [query]);

    const resolveMode = React.useCallback((): 'active' | 'pinned' => {
        if (mode === 'active' || mode === 'pinned') return mode;
        return readIsIdentifierPinned() ? 'pinned' : 'active';
    }, [mode]);

    const applyIdentifier = React.useCallback((rawIdentifier: string, displayName: string = '') => {
        const normalized = normalizeRecentClientIdentifier(rawIdentifier);
        if (!normalized) return false;
        if (!isValidIdentifier(normalized)) return false;

        const writeMode = resolveMode();
        if (writeMode === 'pinned') {
            setPinnedClientIdentifier(currentUser?.id, normalized, displayName);
        } else {
            setActiveClientIdentifier(currentUser?.id, normalized, displayName);
        }
        const updated = pushRecentClientIdentifier(currentUser?.id, normalized, displayName, 50);
        setRecents(updated);
        onClose();
        return true;
    }, [currentUser?.id, onClose, resolveMode]);

    const handleEnter = React.useCallback(() => {
        const highlighted = results[highlightIndex];
        if (highlighted) {
            applyIdentifier(highlighted.identifier, highlighted.displayName);
            return;
        }

        if (!query.trim()) return;
        if (!applyIdentifier(query, '')) {
            // validation feedback (non-blocking, subtle)
            window.dispatchEvent(new CustomEvent('aga:help-error', { detail: { error: 'INVALID_IDENTIFIER_FORMAT' } }));
        }
    }, [applyIdentifier, highlightIndex, query, results]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[140] flex items-start justify-center bg-slate-900/30 backdrop-blur-[2px] px-4 pt-24">
            <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-700">
                        <Pin className="w-4 h-4 text-sky-600" />
                        <span className="text-sm font-semibold">Cambiar identificador</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        title="Cerrar"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-4 border-b border-slate-100">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                    e.preventDefault();
                                    onClose();
                                    return;
                                }
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setHighlightIndex((prev) => Math.min(prev + 1, Math.max(results.length - 1, 0)));
                                    return;
                                }
                                if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setHighlightIndex((prev) => Math.max(prev - 1, 0));
                                    return;
                                }
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleEnter();
                                }
                            }}
                            placeholder="Escribe o pega identificador..."
                            className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-sky-500/10 focus:border-sky-500 outline-none transition-all"
                        />
                        {query && (
                            <button
                                onClick={() => setQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                title="Limpiar"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">Tip: pega un identificador completo y pulsa Enter para aplicarlo.</p>
                </div>

                <div className="max-h-[340px] overflow-auto">
                    {results.length === 0 ? (
                        <div className="px-4 py-6 text-sm text-slate-500">Sin coincidencias.</div>
                    ) : (
                        results.map((entry, index) => (
                            <button
                                key={entry.identifier}
                                type="button"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    applyIdentifier(entry.identifier, entry.displayName);
                                }}
                                className={`w-full px-4 py-2.5 text-left border-b border-slate-50 last:border-0 ${index === highlightIndex ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-slate-700">{entry.identifier}</span>
                                    <span className="truncate text-xs text-slate-500 ml-auto">{entry.displayName || '-'}</span>
                                </div>
                            </button>
                        ))
                    )}
                </div>

                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-t border-slate-100">
                    <span className="text-[11px] text-slate-500">Enter: aplicar · Esc: cerrar</span>
                    <button
                        type="button"
                        onClick={() => {
                            const effective = normalizeRecentClientIdentifier(query);
                            if (!effective) return;
                            navigator.clipboard.writeText(effective).catch(() => undefined);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                    >
                        <Copy className="w-3.5 h-3.5" />
                        Copiar
                    </button>
                </div>
            </div>
        </div>
    );
};

