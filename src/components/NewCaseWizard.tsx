
import React, { useState, useEffect, useMemo } from 'react';
import { X, User, Check, AlertCircle } from 'lucide-react';
import { PrefixConfig, User as UserType } from '../types';
import { Client } from '../types/client';
import { getActivePrefixes, getPrefixNextNumber } from '../services/prefixService';
import { createNewCase } from '../services/firestoreService';
import SearchableSelect, { SelectOption } from './ui/SearchableSelect';
import ConfirmationModal from './ConfirmationModal';
import { Button } from './ui/Button';
import { normalizeRecentClientIdentifier, readEffectiveClientIdentifier } from '@/utils/recentClientIdentifiers';
import { useAppContext } from '@/contexts/AppContext';
import { ClientTypeahead } from './ClientTypeahead';

interface NewCaseWizardProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated: (fileNumber: string) => void;
    users: UserType[];
    currentUser?: UserType;
    initialPrefixId?: string;
    initialClientId?: string;
    forceBlankClientSelection?: boolean;
}

const LAST_USED_PREFIX_KEY = 'gestor_pro_last_prefix_id';

const NewCaseWizard: React.FC<NewCaseWizardProps> = ({ isOpen, onClose, onCreated, users, currentUser, initialPrefixId, initialClientId, forceBlankClientSelection = false }) => {
    const { savedClients } = useAppContext();
    // Data lists
    const [prefixes, setPrefixes] = useState<PrefixConfig[]>([]);

    // Selection state
    const [selectedPrefixId, setSelectedPrefixId] = useState<string>('');
    const [selectedClientId, setSelectedClientId] = useState<string>('');
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [responsibleId, setResponsibleId] = useState<string>('');

    // Result/Status state
    const [isInitializing, setIsInitializing] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showConfirmClose, setShowConfirmClose] = useState(false);

    useEffect(() => {
        if (isOpen) {
            loadInitialData();
        }
    }, [isOpen]);

    const loadInitialData = async () => {
        setIsInitializing(true);
        setError(null);
        try {
            // Load only what is required at open time.
            const prefixesData = await getActivePrefixes();

            setPrefixes(prefixesData);

            // Set initial prefix only if explicitly provided
            if (initialPrefixId && prefixesData.length > 0) {
                const targetPrefix = prefixesData.find(p => p.id === initialPrefixId || p.code === initialPrefixId);
                if (targetPrefix) {
                    setSelectedPrefixId(targetPrefix.id);
                }
            }

            // Preselect client only when context comes from a specific identifier/client explorer
            const normalizedInitial = normalizeRecentClientIdentifier(initialClientId);
            const normalizedEffective = normalizeRecentClientIdentifier(readEffectiveClientIdentifier());
            const preselectedById = initialClientId
                ? savedClients.find(c => c.id === initialClientId)
                : null;
            const preselectedByIdentifier = normalizedInitial
                ? savedClients.find(c =>
                    normalizeRecentClientIdentifier(c.documento) === normalizedInitial ||
                    normalizeRecentClientIdentifier(c.nif) === normalizedInitial
                )
                : null;
            const preselectedByActiveIdentifier = !forceBlankClientSelection && normalizedEffective
                ? savedClients.find(c =>
                    normalizeRecentClientIdentifier(c.documento) === normalizedEffective ||
                    normalizeRecentClientIdentifier(c.nif) === normalizedEffective
                )
                : null;

            const resolvedClient = preselectedById || preselectedByIdentifier || preselectedByActiveIdentifier;
            setSelectedClientId(resolvedClient ? resolvedClient.id : '');
            setSelectedClient(resolvedClient || null);

            // Set initial responsible
            if (currentUser) {
                setResponsibleId(currentUser.id);
            } else if (users.length > 0) {
                setResponsibleId(users[0].id);
            }
        } catch (err) {
            console.error(err);
            setError('Error al cargar datos iniciales. Compruebe su conexión.');
        } finally {
            setIsInitializing(false);
        }
    };

    const handlePrefixChange = (id: string) => {
        setSelectedPrefixId(id);
    };

    const handleCancel = () => {
        if (selectedClientId) {
            setShowConfirmClose(true);
        } else {
            onClose();
        }
    };

    const handleCreate = async () => {
        if (!selectedClientId) {
            setError('Por favor, seleccione un cliente para continuar.');
            return;
        }

        if (!selectedPrefixId) {
            setError('Debes seleccionar un prefijo para crear el expediente.');
            return;
        }

        if (!responsibleId) {
            setError('Por favor, asigne un responsable al expediente.');
            return;
        }

        setIsCreating(true);
        setError(null);
        try {
            const prefix = prefixes.find(p => p.id === selectedPrefixId);
            const client = selectedClient || savedClients.find(c => c.id === selectedClientId);

            if (!prefix || !client) throw new Error("Datos de selección no válidos");

            // Generate the next number atomically right before creation
            // This prevents duplicate numbers in high-concurrency environments
            const nextNumResult = await getPrefixNextNumber(prefix.id);
            const fileNumber = `${prefix.code}-${nextNumResult.formattedNumber}`;

            // Create snapshot for the case (denormalization for faster listing/history)
            const clientSnapshot = {
                nombre: client.nombre,
                documento: client.documento || client.nif || null,
                telefono: client.telefono || null
            };

            const newCase = await createNewCase(
                prefix.code as any,
                '',
                fileNumber,
                responsibleId,
                client.id,
                clientSnapshot,
                prefix.id,
                { deferMovementInitialization: true }
            );

            onCreated(newCase.fileNumber);
            localStorage.setItem(LAST_USED_PREFIX_KEY, selectedPrefixId);
            onClose();
        } catch (err) {
            console.error(err);
            setError('Error al crear el expediente. Es posible que el número ya se haya asignado.');
        } finally {
            setIsCreating(false);
        }
    };

    // --- Memoized Options for SearchableSelect ---

    const prefixOptions = useMemo((): SelectOption[] => {
        const lastId = localStorage.getItem(LAST_USED_PREFIX_KEY);
        const mapped = prefixes.map(p => ({
            id: p.id,
            label: `${p.code} – ${p.description}`,
            subLabel: p.id === lastId ? `Sugerencia: Último usado • ${p.code}` : p.code,
            searchValue: `${p.code} ${p.description}`
        }));

        if (lastId) {
            return [...mapped].sort((a, b) => {
                if (a.id === lastId) return -1;
                if (b.id === lastId) return 1;
                return a.label.localeCompare(b.label);
            });
        }
        return mapped;
    }, [prefixes]);

    const userOptions = useMemo((): SelectOption[] =>
        users.map(u => ({
            id: u.id,
            label: u.name,
            subLabel: u.role === 'admin' ? 'Administrador' : 'Gestor',
            searchValue: `${u.name} ${u.initials}`
        }))
        , [users]);

    const currentSelectedClient = useMemo(() => (
        selectedClient || savedClients.find(c => c.id === selectedClientId) || null
    ), [selectedClient, savedClients, selectedClientId]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200" onClick={handleCancel}>
            <div
                className="bg-white w-full max-w-md rounded-[32px] shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200"
                role="dialog"
                aria-modal="true"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-6 border-b border-slate-100 flex items-center justify-between bg-white">
                    <h3 className="text-xl font-bold text-slate-800">Crear nuevo expediente</h3>
                    <button
                        onClick={handleCancel}
                        className="p-2 hover:bg-red-50 rounded-full text-slate-400 hover:text-red-500 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto no-scrollbar">
                    {error && (
                        <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex gap-3 text-rose-600 text-sm animate-in shake duration-500">
                            <AlertCircle className="w-5 h-5 shrink-0" />
                            <p>{error}</p>
                        </div>
                    )}

                    {/* Client Preview / Selector Area */}
                    <div className="space-y-3">
                        <div className="bg-sky-50 rounded-2xl p-6 border border-sky-100 flex flex-col items-center justify-center gap-2 transition-all">
                            <span className="text-sky-600/60 text-[10px] font-bold uppercase tracking-[0.15em]">Vista previa del identificador del cliente</span>
                            <div className="text-xl font-bold text-sky-900 tracking-tight text-center min-h-[1.5rem] flex items-center">
                                {currentSelectedClient ? (
                                    <div className="flex flex-col items-center">
                                        <span className="font-mono text-sky-700">{currentSelectedClient.documento || currentSelectedClient.nif || 'CLI-TEMP'}</span>
                                        <span className="text-xs text-sky-600/70 font-medium uppercase tracking-wider">{currentSelectedClient.nombre}</span>
                                    </div>
                                ) : (
                                    <span className="text-sky-200 italic font-normal">Pendiente de selección</span>
                                )}
                            </div>
                        </div>

                        <ClientTypeahead
                            valueClientId={selectedClientId}
                            valueLabel={currentSelectedClient ? (currentSelectedClient.nombre || currentSelectedClient.legalName || '') : ''}
                            placeholder="Buscar cliente por nombre o DNI..."
                            disabled={isCreating}
                            onSelect={(client) => {
                                const selected = client as unknown as Client;
                                setSelectedClientId(selected.id || '');
                                setSelectedClient(selected);
                            }}
                            onClear={() => {
                                setSelectedClientId('');
                                setSelectedClient(null);
                            }}
                        />
                    </div>

                    <div className="space-y-4 pt-2 border-t border-slate-50">
                        {/* Prefix Searchable Select */}
                        <SearchableSelect
                            label="Prefijo de expediente"
                            options={prefixOptions}
                            value={selectedPrefixId}
                            onChange={handlePrefixChange}
                            placeholder="Selecciona un prefijo de expediente"
                            loading={isInitializing}
                        />

                        {/* Responsible Searchable Select */}
                        <div className="space-y-1.5">
                            <label className="block text-[13px] font-medium text-slate-700 ml-1">
                                Responsable
                            </label>
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <SearchableSelect
                                        options={userOptions}
                                        value={responsibleId}
                                        onChange={setResponsibleId}
                                        placeholder="Seleccionar gestor..."
                                    />
                                </div>
                                {currentUser && (
                                    <button
                                        onClick={() => setResponsibleId(currentUser.id)}
                                        title="Asignarme a mí"
                                        className={`
                                            h-11 px-4 rounded-xl border flex items-center gap-2 transition-all active:scale-95
                                            ${responsibleId === currentUser.id
                                                ? 'bg-sky-50 border-sky-200 text-sky-700 shadow-sm'
                                                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'}
                                        `}
                                    >
                                        <User className={`size-4 ${responsibleId === currentUser.id ? 'text-sky-600' : 'text-slate-400'}`} />
                                        <span className="text-xs font-bold uppercase tracking-wider">Yo</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
                    <Button
                        variant="outline"
                        size="lg"
                        className="flex-1"
                        onClick={handleCancel}
                    >
                        Cancelar
                    </Button>
                    <Button
                        variant="primary"
                        size="lg"
                        className="flex-[2]"
                        onClick={handleCreate}
                        disabled={isCreating || !selectedPrefixId || !selectedClientId || !responsibleId}
                        isLoading={isCreating}
                        icon={Check}
                    >
                        Crear expediente
                    </Button>
                </div>

                <ConfirmationModal
                    isOpen={showConfirmClose}
                    title="Alta de expediente"
                    message="Has empezado a configurar un nuevo expediente. ¿Estás seguro de que deseas cancelar el proceso?"
                    confirmText="Seguir configurando"
                    secondaryText="Descartar y salir"
                    cancelText="Cerrar"
                    variant="primary"
                    onClose={() => setShowConfirmClose(false)}
                    onConfirm={() => setShowConfirmClose(false)}
                    secondaryAction={onClose}
                />
            </div>
        </div>
    );
};

export default NewCaseWizard;
