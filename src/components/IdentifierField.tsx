import React, { useState, useEffect } from 'react';
import { Eye, Copy, Info, ChevronRight } from 'lucide-react';
import { CopyAction } from '@/components/ui/ActionFeedback';
import { calculateNIF } from '@/utils/fiscalUtils';
import { searchClients } from '@/services/clientService';
import { Client } from '@/types';

interface IdentifierFieldProps {
    value: string;
    onChange: (value: string, detectedTipo?: 'PARTICULAR' | 'EMPRESA', fullNif?: string) => void;
    onSelectDuplicate?: (id: string) => void;
    onAutofill?: (client: Client) => void;
    label?: string;
    placeholder?: string;
    className?: string;
    inputClassName?: string;
    labelClassName?: string;
    excludeId?: string; // To avoid finding itself if editing
    autoClean?: boolean;
}

export const IdentifierField: React.FC<IdentifierFieldProps> = ({
    value,
    onChange,
    onSelectDuplicate,
    onAutofill,
    label = "Identificador",
    placeholder = "00000000X",
    className = "",
    inputClassName = "",
    labelClassName = "",
    excludeId,
    autoClean = true
}) => {
    const [isDuplicate, setIsDuplicate] = useState(false);
    const [duplicateName, setDuplicateName] = useState("");
    const [duplicateId, setDuplicateId] = useState<string | null>(null);
    const [showNifPreview, setShowNifPreview] = useState(false);

    const fullNif = calculateNIF(value);

    useEffect(() => {
        let active = true;
        if (value && value.length >= 8) {
            const checkDupe = async () => {
                try {
                    const results = await searchClients({ documento: value, limit: 1 });
                    if (active && results.items.length > 0) {
                        const exactMatch = results.items.find(c => c.documento === value && c.id !== excludeId);
                        if (exactMatch) {
                            setIsDuplicate(true);
                            setDuplicateName(exactMatch.nombre);
                            setDuplicateId(exactMatch.id);
                            // Autofill if callback provided
                            if (onAutofill) onAutofill(exactMatch);
                        } else {
                            setIsDuplicate(false);
                            setDuplicateId(null);
                        }
                    } else if (active) {
                        setIsDuplicate(false);
                        setDuplicateId(null);
                    }
                } catch (err) {
                    console.error("Error checking dupe", err);
                }
            };
            checkDupe();
        } else {
            setIsDuplicate(false);
            setDuplicateId(null);
        }
        return () => { active = false; };
    }, [value, excludeId, onAutofill]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value.toUpperCase();
        let detectedTipo: 'PARTICULAR' | 'EMPRESA' = 'PARTICULAR';

        if (autoClean && val.length > 0) {
            const first = val.charAt(0);
            if (/^[ABCDEFGHJNPQRSUVW]/.test(first)) {
                // CIF: Letra + hasta 8 números
                const nums = val.slice(1).replace(/\D/g, "").slice(0, 8);
                val = first + nums;
                detectedTipo = 'EMPRESA';
            } else {
                // DNI: Solo números hasta 8
                val = val.replace(/\D/g, "").slice(0, 8);
                detectedTipo = 'PARTICULAR';
            }
        }

        onChange(val, detectedTipo, calculateNIF(val));
    };

    return (
        <div className={`space-y-1.5 ${className}`}>
            <div className="flex items-center justify-between gap-2">
                <label className={labelClassName || "app-label-block"}>{label}</label>
                <div className="flex items-center gap-1.5">
                    {isDuplicate && (
                        <div className="flex items-center gap-2 px-2.5 py-1 bg-amber-50 border border-amber-100 rounded-full animate-in fade-in slide-in-from-right-2 duration-300">
                            <div className="flex items-center gap-1.5 text-[9px] font-bold text-amber-700 uppercase tracking-tight">
                                <Info size={11} className="text-amber-500" />
                                <span className="max-w-[120px] truncate">Ya existe: {duplicateName}</span>
                            </div>
                            {onSelectDuplicate && duplicateId && (
                                <>
                                    <div className="w-px h-3 bg-amber-200/50" />
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            onSelectDuplicate(duplicateId);
                                        }}
                                        className="text-[9px] font-black text-amber-600 hover:text-amber-800 transition-colors uppercase tracking-widest flex items-center gap-0.5 group"
                                    >
                                        Ficha
                                        <ChevronRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                    {value && (
                        <div className="flex items-center gap-0.5">
                            <div className="relative inline-block">
                                {showNifPreview && (
                                    <div className="absolute top-full right-0 mt-3 w-44 bg-white/95 backdrop-blur-md border border-slate-100 shadow-2xl rounded-2xl p-4 transition-all duration-300 z-[60] origin-top-right animate-in fade-in zoom-in-95">
                                        <div className="flex flex-col">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 whitespace-normal leading-none mb-2">NIF COMPLETO</span>
                                            <span className="text-xl font-mono text-sky-600 tracking-tight font-medium">
                                                {fullNif}
                                            </span>
                                        </div>
                                        <div className="absolute top-[-6px] right-4 size-3 bg-white border-l border-t border-slate-100 rotate-45" />
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onMouseEnter={() => setShowNifPreview(true)}
                                    onMouseLeave={() => setShowNifPreview(false)}
                                    className={`p-1.5 rounded-lg transition-all duration-200 ${showNifPreview ? 'bg-indigo-50 text-indigo-600 shadow-sm' : 'text-slate-300 hover:text-sky-600 hover:bg-sky-50'}`}
                                >
                                    <Eye size={15} strokeWidth={2} />
                                </button>
                            </div>
                            <CopyAction text={value}>
                                <div className="p-1.5 text-slate-300 hover:text-sky-600 transition-colors hover:bg-sky-50 rounded-lg group">
                                    <Copy size={15} strokeWidth={2} />
                                </div>
                            </CopyAction>
                        </div>
                    )}
                </div>
            </div>
            <input
                value={value}
                onChange={handleInputChange}
                className={inputClassName || "w-full h-8 px-2 bg-white border-b border-[#cfdbe7] text-sm font-normal text-slate-800 focus:border-[#1380ec] outline-none transition-all placeholder:text-slate-300"}
                placeholder={placeholder}
            />
        </div>
    );
};
