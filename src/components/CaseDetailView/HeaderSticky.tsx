import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical, ShieldCheck, Calendar, User, Plus, HelpCircle, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface HeaderStickyProps {
    fullFileNumber: string;
    caseStatus: string;
    setCaseStatus: (s: string) => void;
    availableStatuses: string[];
    responsibleUserId: string;
    onResponsibleChange: (userId: string) => void;
    openingDate: string;
    onOpeningDateChange: (date: string) => void;
    users: any[];
    saldo: string;
    isSaving: boolean;
    hasUnsavedChanges: boolean;
    onSave: () => Promise<void>;
    onPrint: () => void;
    onClose: () => void;
    onToggleClose: () => void;
    onAddResponsible?: () => void;
    duplicateOf?: string;
    onNewCaseSameClient?: () => void;
    onNewCaseDifferentClient?: () => void;
    showNewCaseActions?: boolean;
}

export const HeaderSticky: React.FC<HeaderStickyProps> = ({
    fullFileNumber,
    caseStatus,
    setCaseStatus,
    availableStatuses,
    responsibleUserId,
    onResponsibleChange,
    openingDate,
    onOpeningDateChange,
    users,
    saldo,
    isSaving,
    hasUnsavedChanges,
    onSave,
    onPrint,
    onClose,
    onAddResponsible,
    duplicateOf,
    onNewCaseSameClient,
    onNewCaseDifferentClient,
    showNewCaseActions = true
}) => {
    const [showShortcuts, setShowShortcuts] = useState(false);
    const shortcutsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!showShortcuts) return;
        const handleOutside = (event: MouseEvent) => {
            if (shortcutsRef.current && !shortcutsRef.current.contains(event.target as Node)) {
                setShowShortcuts(false);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, [showShortcuts]);

    return (

        <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-md py-3 border-b border-slate-200 px-8 flex items-center justify-between shadow-sm transition-all duration-300">
            <div className="flex items-center gap-6 divide-x divider-corporate">
                {/* Identity & Duplication Warning */}
                <div className="flex flex-col gap-1 min-w-[280px]">
                    {/* Labels Row */}
                    <div className="flex justify-between items-center">
                        <span className="app-label !text-sky-500 !tracking-tight">Nº EXPEDIENTE:</span>
                        <span className="app-label !text-emerald-600 !tracking-tight uppercase">Saldo</span>
                    </div>
                    {/* Values Row */}
                    <div className="flex justify-between items-baseline gap-6">
                        <div className="flex items-center gap-3">
                            <h1 className="text-slate-900 text-xl font-normal tracking-tight font-mono leading-none">
                                {fullFileNumber}
                            </h1>
                            {duplicateOf && (
                                <span className="px-2 py-0.5 bg-amber-50 text-[9px] font-normal text-amber-600 border border-amber-100 rounded-md uppercase tracking-tighter shrink-0">
                                    Duplicando: {duplicateOf}
                                </span>
                            )}
                        </div>
                        <div className="text-right">
                            <span className="app-value !text-xl !text-emerald-600 font-medium leading-none whitespace-nowrap">
                                {saldo}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Status & Responsible Dropdowns */}
                <div className="pl-6 flex items-center gap-4">
                    {/* Status */}
                    <div className="relative group">
                        <div className="flex flex-col">
                            <span className="app-label-block">
                                <ShieldCheck size={10} className="inline mr-1 opacity-70" /> Estado
                            </span>
                            <div className="relative group/select">
                                <select
                                    value={caseStatus}
                                    onChange={(e) => setCaseStatus(e.target.value)}
                                    className="h-9 min-w-[160px] pl-3 pr-8 bg-slate-50 border border-slate-200 rounded-xl text-xs font-normal text-slate-700 outline-none focus:ring-4 focus:ring-sky-500/10 focus:border-sky-500 transition-all appearance-none cursor-pointer hover:bg-white"
                                >
                                    {availableStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <MoreVertical size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none rotate-90" />
                            </div>
                        </div>
                    </div>

                    {/* Responsible */}
                    <div className={`relative group ${onAddResponsible ? 'mr-10' : ''}`}>
                        <div className="flex flex-col">
                            <span className="app-label-block">
                                <User size={10} className="inline mr-1 opacity-70" /> Responsable
                            </span>
                            <div className="relative group/select">
                                <select
                                    value={responsibleUserId}
                                    onChange={(e) => onResponsibleChange(e.target.value)}
                                    className="h-9 min-w-[200px] pl-3 pr-10 bg-slate-50 border border-slate-200 rounded-xl text-xs font-normal text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all appearance-none cursor-pointer hover:bg-white"
                                >
                                    {users.length === 0 ? (
                                        <option value="">No hay gestores definidos</option>
                                    ) : (
                                        <>
                                            <option value="">Asignar gestor...</option>
                                            {users.map(u => (
                                                <option key={u.id} value={u.id}>{u.name}</option>
                                            ))}
                                        </>
                                    )}
                                </select>
                                <MoreVertical size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none rotate-90" />

                                {onAddResponsible && (
                                    <button
                                        onClick={onAddResponsible}
                                        className="absolute -right-8 top-1/2 -translate-y-1/2 p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-all shadow-sm border border-indigo-100"
                                        title="Nuevo Responsable"
                                    >
                                        <Plus size={14} strokeWidth={3} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Opening Date */}
                    <div className="relative group">
                        <div className="flex flex-col">
                            <span className="app-label-block">
                                <Calendar size={10} className="inline mr-1 opacity-70" /> Apertura
                            </span>
                            <input
                                type="date"
                                value={openingDate?.slice(0, 10)}
                                onChange={(e) => onOpeningDateChange(e.target.value)}
                                className="h-9 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-normal text-slate-600 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all cursor-pointer hover:bg-white"
                            />
                        </div>
                    </div>
                </div>

            </div>

            <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                    <Button
                        variant="primary"
                        size="icon"
                        onClick={onSave}
                        isLoading={isSaving}
                        title={isSaving ? 'Guardando...' : 'Guardar y cerrar (Ctrl/Cmd+Enter)'}
                        className="shrink-0"
                    >
                        <ShieldCheck size={18} />
                    </Button>

                    <div className="relative" ref={shortcutsRef}>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowShortcuts(v => !v)}
                            title="Atajos de teclado"
                            className="text-slate-400 hover:text-slate-700"
                        >
                            <HelpCircle size={18} />
                        </Button>

                        {showShortcuts && (
                            <div className="absolute right-0 top-[calc(100%+8px)] w-72 rounded-xl border border-slate-200 bg-white shadow-xl z-50 p-3">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Atajos</p>
                                <div className="space-y-1.5 text-xs text-slate-600">
                                    <p><span className="font-bold text-slate-800">Ctrl/Cmd+Enter</span> guardar y cerrar</p>
                                    <p><span className="font-bold text-slate-800">Ctrl/Cmd+N</span> nuevo con mismo cliente</p>
                                    <p><span className="font-bold text-slate-800">Ctrl/Cmd+Shift+N</span> nuevo con otro cliente</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onPrint}
                        title="Imprimir"
                        className="text-slate-500 hover:text-slate-700"
                    >
                        <Printer size={18} />
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        title={hasUnsavedChanges ? 'Cerrar y descartar cambios' : 'Cerrar'}
                        className="text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                    >
                        <X size={18} />
                    </Button>
                </div>

                {showNewCaseActions && (onNewCaseSameClient || onNewCaseDifferentClient) && (
                    <div className="flex flex-col items-end gap-2 w-full">
                        {onNewCaseSameClient && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onNewCaseSameClient}
                                title="Nuevo con mismo cliente y prefijo (Ctrl/Cmd+N)"
                                className="flex items-center justify-center gap-2 w-full px-4 py-2 border rounded-xl transition-all text-xs font-bold shadow-sm active:scale-95 bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100 hover:text-sky-800 active:bg-sky-100"
                            >
                                <Plus size={14} className="stroke-[3]" />
                                Nuevo (mismo cliente)
                            </Button>
                        )}
                        {onNewCaseDifferentClient && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={onNewCaseDifferentClient}
                                title="Nuevo con cliente distinto (Ctrl/Cmd+Shift+N)"
                                className="flex items-center justify-center gap-2 w-full px-4 py-2 border rounded-xl transition-all text-xs font-bold shadow-sm active:scale-95 bg-white text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-800 active:bg-slate-100"
                            >
                                <Plus size={14} className="stroke-[3]" />
                                Nuevo (otro cliente)
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
