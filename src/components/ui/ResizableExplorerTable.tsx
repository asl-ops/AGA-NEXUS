import React, { useState, useCallback, useRef } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import {
    COLUMN_RESIZE_UX_CHANGED_EVENT,
    readColumnResizeGuidesEnabled
} from '@/services/columnResizeUxService';

export interface ExplorerColumn<T> {
    id: string;
    label: string;
    minWidth: number;
    defaultWidth: number;
    align?: 'left' | 'center' | 'right';
    type?: 'text' | 'number' | 'currency' | 'date' | 'status';
    isNumeric?: boolean;
    isActions?: boolean;
    resizable?: boolean;
    sortable?: boolean;
    sortAccessor?: (row: T) => string | number | Date | null | undefined;
    truncate?: boolean;
    render: (row: T) => React.ReactNode;
}

interface ResizableExplorerTableProps<T> {
    data: T[];
    columns: ExplorerColumn<T>[];
    storageKey: string;
    onRowClick?: (row: T) => void;
    onRowDoubleClick?: (row: T) => void;
    selectedRowIds?: string[] | number[];
    sortConfig?: { key: string; direction: 'asc' | 'desc' } | null;
    onSort?: (key: string) => void;
    rowIdKey: keyof T;
    onToggleSelectAll?: () => void;
    allSelected?: boolean;
    className?: string;
    density?: 'compact' | 'normal';
    zebra?: boolean;
    rowClassName?: (row: T, rowIndex: number) => string;
}

export function ResizableExplorerTable<T>({
    data,
    columns,
    storageKey,
    onRowClick,
    onRowDoubleClick,
    selectedRowIds = [],
    sortConfig,
    onSort,
    rowIdKey,
    onToggleSelectAll,
    allSelected,
    className = '',
    density = 'compact',
    zebra = true,
    rowClassName
}: ResizableExplorerTableProps<T>) {
    const sortStorageKey = `${storageKey}:sort`;
    const [resizeGuidesEnabled, setResizeGuidesEnabled] = useState<boolean>(() => readColumnResizeGuidesEnabled());

    React.useEffect(() => {
        const onChanged = (event: Event) => {
            const customEvent = event as CustomEvent<{ enabled?: boolean }>;
            if (typeof customEvent.detail?.enabled === 'boolean') {
                setResizeGuidesEnabled(customEvent.detail.enabled);
                return;
            }
            setResizeGuidesEnabled(readColumnResizeGuidesEnabled());
        };
        window.addEventListener(COLUMN_RESIZE_UX_CHANGED_EVENT, onChanged as EventListener);
        return () => window.removeEventListener(COLUMN_RESIZE_UX_CHANGED_EVENT, onChanged as EventListener);
    }, []);

    const normalizedColumns = React.useMemo(() => {
        const source = [...columns];
        const actionsIndex = source.findIndex(col => col.isActions || col.id === 'actions');
        if (actionsIndex === -1) return source;
        const [actionsCol] = source.splice(actionsIndex, 1);
        return [actionsCol, ...source];
    }, [columns]);

    const resolveDefaultSort = React.useCallback(() => {
        const dateCol = normalizedColumns.find((col) => {
            if (col.sortable === false || col.isActions || col.id === 'actions' || col.id === 'select') return false;
            if (col.type === 'date') return true;
            const id = col.id.toLowerCase();
            return id.includes('fecha') || id.includes('date') || id.includes('createdat') || id.includes('updatedat');
        });
        return dateCol ? { key: dateCol.id, direction: 'desc' as const } : null;
    }, [normalizedColumns]);

    const [internalSortConfig, setInternalSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(() => {
        try {
            const raw = sessionStorage.getItem(sortStorageKey);
            if (raw) {
                const parsed = JSON.parse(raw) as { key?: string; direction?: 'asc' | 'desc' };
                if (parsed?.key && (parsed.direction === 'asc' || parsed.direction === 'desc')) {
                    return { key: parsed.key, direction: parsed.direction };
                }
            }
        } catch {
            // ignore malformed session sort config
        }
        return null;
    });

    const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error('Error parsing colWidths', e);
            }
        }
        const defaults: Record<string, number> = {};
        normalizedColumns.forEach(col => {
            defaults[col.id] = col.defaultWidth;
        });
        return defaults;
    });

    const resizingRef = useRef<{ colId: string, startX: number, startWidth: number } | null>(null);

    React.useEffect(() => {
        if (sortConfig || internalSortConfig) return;
        const defaultSort = resolveDefaultSort();
        if (defaultSort) {
            setInternalSortConfig(defaultSort);
        }
    }, [sortConfig, internalSortConfig, resolveDefaultSort]);

    React.useEffect(() => {
        if (sortConfig || !internalSortConfig) return;
        sessionStorage.setItem(sortStorageKey, JSON.stringify(internalSortConfig));
    }, [sortStorageKey, sortConfig, internalSortConfig]);

    const getComparableValue = React.useCallback((row: T, col: ExplorerColumn<T>) => {
        const accessorValue = col.sortAccessor ? col.sortAccessor(row) : (row as Record<string, unknown>)[col.id];
        if (accessorValue === null || accessorValue === undefined) return '';
        if (accessorValue instanceof Date) return accessorValue.getTime();
        if (typeof accessorValue === 'number') return accessorValue;
        if (typeof accessorValue === 'string') {
            const raw = accessorValue.trim();
            if (!raw) return '';
            const id = col.id.toLowerCase();
            const type = col.type;
            const looksLikeDate = type === 'date' || id.includes('fecha') || id.includes('date') || id.includes('createdat') || id.includes('updatedat');
            if (looksLikeDate) {
                const timestamp = Date.parse(raw);
                if (!Number.isNaN(timestamp)) return timestamp;
            }
            const looksNumeric = type === 'number' || type === 'currency' || col.isNumeric;
            if (looksNumeric) {
                const normalized = raw
                    .replace(/\s+/g, '')
                    .replace('€', '')
                    .replace(/\./g, '')
                    .replace(',', '.');
                const numeric = Number(normalized);
                if (!Number.isNaN(numeric)) return numeric;
            }
            return raw;
        }
        return String(accessorValue);
    }, []);

    const effectiveSortConfig = sortConfig ?? internalSortConfig;

    const displayedData = React.useMemo(() => {
        if (sortConfig || !effectiveSortConfig) return data;
        const sortColumn = normalizedColumns.find((col) => col.id === effectiveSortConfig.key);
        if (!sortColumn || sortColumn.sortable === false) return data;
        const sorted = [...data];
        sorted.sort((a, b) => {
            const aVal = getComparableValue(a, sortColumn);
            const bVal = getComparableValue(b, sortColumn);
            let cmp = 0;
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                cmp = aVal - bVal;
            } else {
                cmp = String(aVal).localeCompare(String(bVal), 'es-ES', { sensitivity: 'base', numeric: true });
            }
            return effectiveSortConfig.direction === 'asc' ? cmp : -cmp;
        });
        return sorted;
    }, [data, sortConfig, effectiveSortConfig, normalizedColumns, getComparableValue]);

    const handleColResizeMove = useCallback((e: MouseEvent) => {
        if (!resizingRef.current) return;

        const { colId, startX, startWidth } = resizingRef.current;
        const column = normalizedColumns.find(c => c.id === colId);
        const minWidth = column?.minWidth || 60;
        const maxWidth = 600;

        const delta = e.clientX - startX;
        const nextWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));

        setColWidths(prev => ({
            ...prev,
            [colId]: nextWidth
        }));
    }, [normalizedColumns]);

    const handleColResizeEnd = useCallback(() => {
        if (resizingRef.current) {
            setColWidths(prev => {
                localStorage.setItem(storageKey, JSON.stringify(prev));
                return prev;
            });
        }

        resizingRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        window.removeEventListener('mousemove', handleColResizeMove);
        window.removeEventListener('mouseup', handleColResizeEnd);
    }, [handleColResizeMove, storageKey]);

    const handleColResizeStart = (e: React.MouseEvent, colId: string) => {
        e.preventDefault();
        e.stopPropagation();

        const column = normalizedColumns.find(c => c.id === colId);
        if (!column) return;

        resizingRef.current = {
            colId,
            startX: e.clientX,
            startWidth: colWidths[colId] || column.defaultWidth
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        window.addEventListener('mousemove', handleColResizeMove);
        window.addEventListener('mouseup', handleColResizeEnd);
    };

    const rowHeightClass = density === 'compact' ? 'py-1.5' : 'py-3';
    const cellTextSize = density === 'compact' ? 'text-[13px]' : 'text-sm';

    const handleSortClick = (columnId: string, isSortable: boolean) => {
        if (!isSortable) return;
        if (onSort) {
            onSort(columnId);
            return;
        }
        setInternalSortConfig((prev) => {
            if (prev?.key === columnId) {
                if (prev.direction === 'asc') return { key: columnId, direction: 'desc' };
                return null;
            }
            return { key: columnId, direction: 'asc' };
        });
    };

    return (
        <div className={`rounded-lg border border-[#cfdbe7] bg-slate-50 w-full overflow-x-auto custom-scrollbar ${className}`}>
            <table className="w-full min-w-max border-collapse" style={{ tableLayout: 'fixed' }}>
                <thead className="sticky top-0 z-20">
                    <tr className="bg-slate-100/80 border-b border-slate-200">
                        {normalizedColumns.map((col) => {
                            const alignClass = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left';
                            const justifyClass = col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : 'justify-start';
                            const isActionsCol = col.isActions || col.id === 'actions';
                            const isSortable = !isActionsCol && col.sortable !== false;
                            const isResizable = !isActionsCol && col.resizable !== false;
                            const width = isActionsCol ? Math.min(72, Math.max(56, col.defaultWidth)) : (colWidths[col.id] || col.defaultWidth);

                            return (
                                <th
                                    key={col.id}
                                    style={{ width }}
                                    className={`relative px-3 py-2 ${alignClass} app-label !text-slate-700 border-r border-r-slate-300/90 last:border-r-0 transition-colors ${isSortable ? 'cursor-pointer hover:bg-slate-200/60' : ''} ${effectiveSortConfig?.key === col.id ? 'bg-sky-50/60' : ''}`}
                                    title={
                                        isSortable
                                            ? (effectiveSortConfig?.key === col.id
                                                ? `Ordenado por ${col.label} (${effectiveSortConfig.direction.toUpperCase()})`
                                                : `Click para ordenar por ${col.label}`)
                                            : undefined
                                    }
                                    onClick={() => handleSortClick(col.id, isSortable)}
                                >
                                    <div className={`flex items-center gap-1 overflow-hidden ${justifyClass}`}>
                                        {col.id === 'select' ? (
                                            <input
                                                type="checkbox"
                                                checked={allSelected}
                                                onChange={onToggleSelectAll}
                                                className="h-4 w-4 rounded border-slate-200 border-2 bg-transparent text-[#4c739a] checked:bg-[#4c739a] checked:border-[#4c739a] focus:ring-0 focus:ring-offset-0 focus:border-slate-200 focus:outline-none"
                                            />
                                        ) : (
                                            <>
                                                <span className="truncate">{col.label}</span>
                                                {isSortable && (
                                                    effectiveSortConfig?.key === col.id ? (
                                                        effectiveSortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-[#1380ec] shrink-0" /> : <ArrowDown className="w-3 h-3 text-[#1380ec] shrink-0" />
                                                    ) : <ArrowUpDown className="w-3 h-3 text-slate-300 shrink-0" />
                                                )}
                                            </>
                                        )}
                                    </div>
                                    {isResizable && (
                                        <div
                                            onMouseDown={(e) => handleColResizeStart(e, col.id)}
                                            className={`absolute right-0 top-0 bottom-0 w-[12px] cursor-col-resize z-10 transition-all ${resizeGuidesEnabled
                                                ? 'opacity-100 hover:bg-sky-100/70 after:absolute after:right-[4px] after:top-1/2 after:h-4 after:w-[2px] after:-translate-y-1/2 after:rounded-full after:bg-sky-500/80'
                                                : 'opacity-85 hover:opacity-100 hover:bg-slate-300/25'
                                                }`}
                                        />
                                    )}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody className="bg-white">
                    {displayedData.map((row, rowIndex) => {
                        const rowId = String(row[rowIdKey]);
                        const isSelected = selectedRowIds.includes(rowId as never);
                        const zebraClass = zebra
                            ? (rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-100/75')
                            : '';
                        const customRowClass = rowClassName ? rowClassName(row, rowIndex) : '';

                        return (
                            <tr
                                key={rowId || rowIndex}
                                className={`border-t app-divider hover:bg-sky-100/70 cursor-pointer transition-colors group ${isSelected ? 'bg-sky-100/80' : zebraClass} ${customRowClass}`}
                                onClick={() => onRowClick?.(row)}
                                onDoubleClick={() => onRowDoubleClick?.(row)}
                            >
                                {normalizedColumns.map((col) => {
                                    const isNumeric = col.isNumeric || col.type === 'number' || col.type === 'currency' || ['importe', 'total', 'debe', 'haber', 'saldo', 'base', 'iva', 'retencion', 'cuota', 'valor', 'amount'].some(token => col.id.toLowerCase().includes(token));
                                    const alignClass = isNumeric || col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left';
                                    const truncateClass = col.truncate === false ? '' : 'truncate';
                                    const numericClass = isNumeric ? 'tabular-nums whitespace-nowrap' : '';
                                    const comparableValue = isNumeric ? getComparableValue(row, col) : null;
                                    const isNegative = typeof comparableValue === 'number' && comparableValue < 0;
                                    return (
                                        <td
                                            key={col.id}
                                            className={`${rowHeightClass} px-3 ${cellTextSize} font-normal leading-tight ${truncateClass} ${alignClass} ${numericClass} ${isNegative ? 'text-rose-700' : 'text-slate-700'} border-r border-r-slate-100/80 last:border-r-0`}
                                            onClick={(col.id === 'select' || col.id === 'actions' || col.id === 'quick_view') ? (e) => e.stopPropagation() : undefined}
                                        >
                                            {col.render(row)}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
