import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { CasePrintView } from './CaseDetailView/CasePrintView';
import {
    Client,
    Vehicle,
    Task,
    CaseStatus,
    FileConfig,
    Communication,
    EconomicData,
    MovimientoExpediente,
    AttachedDocument,
    CaseRecord,
    Administrator,
    DEFAULT_CASE_STATUSES,
    EconomicLineItem
} from '../types';
import {
    StickyNote
} from 'lucide-react';
import VehicleDataSection from './VehicleDataSection';
import { EconomicMovementsSection } from './EconomicMovementsSection';
import CommunicationsSection from './CommunicationsSection';
import SettingsModal from './SettingsModal';
import HermesConfigModal from './HermesConfigModal';
import AttachedDocumentsSection from './AttachedDocumentsSection';
import AttachedDocumentsModal from './AttachedDocumentsModal';

import GenerateMandateModal from './GenerateMandateModal';
import AdministratorsModal from './AdministratorsModal';
import RegisterPaymentModal from './RegisterPaymentModal';
import ClientDetailModal from './ClientDetailModal';
import ConfirmationModal from './ConfirmationModal';
import { useAppContext } from '../contexts/AppContext';
import { useFeedback } from '@/hooks/useFeedback';
import { prepareMandateData, generateMandatePDF, generateMandateFileName } from '../services/mandateService';
import { MandateData } from '@/types/mandate';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../services/firebase';
import { getPrefixes } from '../services/prefixService';
import { HeaderSticky } from './CaseDetailView/HeaderSticky';
import { ClientCard } from './CaseDetailView/ClientCard';
import { QuickUserModal } from './CaseDetailView/QuickUserModal';

interface CaseDetailViewProps {
    client: Client; setClient: React.Dispatch<React.SetStateAction<Client>>;
    clienteId?: string | null; setClienteId?: (id: string | null) => void;
    clientSnapshot?: {
        nombre: string;
        documento?: string;
        telefono?: string;
        email?: string;
        cuentaContable?: string;
    } | null;
    setClientSnapshot?: (snapshot: {
        nombre: string;
        documento?: string;
        telefono?: string;
        email?: string;
        cuentaContable?: string;
    } | null) => void;
    vehicle: Vehicle; setVehicle: React.Dispatch<React.SetStateAction<Vehicle>>;
    economicData: EconomicData; setEconomicData: React.Dispatch<React.SetStateAction<EconomicData>>;
    movimientos: MovimientoExpediente[]; setMovimientos: React.Dispatch<React.SetStateAction<MovimientoExpediente[]>>;
    communications: Communication[]; setCommunications: React.Dispatch<React.SetStateAction<Communication[]>>;
    attachments: AttachedDocument[]; setAttachments: React.Dispatch<React.SetStateAction<AttachedDocument[]>>;
    tasks: Task[];
    fileConfig: FileConfig; onFileConfigChange: (newConfig: FileConfig) => void;
    fileNumber: string;
    description: string; setDescription: React.Dispatch<React.SetStateAction<string>>;
    caseStatus: CaseStatus; setCaseStatus: React.Dispatch<React.SetStateAction<CaseStatus>>;
    onSave: (tasks: Task[], forcedFileNumber?: string) => Promise<boolean>;
    onReturnToDashboard: () => void;
    onBatchVehicleProcessing: (files: File[]) => void;
    isBatchProcessing: boolean;
    onAddDocuments: (files: File[]) => void;
    isClassifying: boolean;
    isSaving: boolean;
    createdAt: string;
    duplicateOf?: string | null;
    onDeleteClient?: (clientId: string) => Promise<void>;
    onNewCaseSameClient?: () => void;
    onNewCaseDifferentClient?: () => void;
}


const CaseDetailView: React.FC<CaseDetailViewProps> = ({
    client, setClient,
    clienteId,
    clientSnapshot,
    vehicle, setVehicle,
    economicData, setEconomicData,
    movimientos, setMovimientos,
    communications, setCommunications,
    attachments, setAttachments,
    tasks: propTasks,
    fileConfig, onFileConfigChange,
    fileNumber,
    description, setDescription,
    caseStatus, setCaseStatus,
    onSave,
    onReturnToDashboard,
    onBatchVehicleProcessing,
    isBatchProcessing,
    onAddDocuments,
    isSaving,
    createdAt,
    duplicateOf,
    onNewCaseSameClient,
    onNewCaseDifferentClient,
}) => {
    const { currentUser, users, caseHistory, savedClients, saveClient, saveUser, appSettings } = useAppContext();
    const { toast } = useFeedback();
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [isHermesModalOpen, setIsHermesModalOpen] = useState(false);
    const [isDocumentsModalOpen, setIsDocumentsModalOpen] = useState(false);
    const [isRegisterPaymentModalOpen, setIsRegisterPaymentModalOpen] = useState(false);
    const [isMandatoModalOpen, setIsMandatoModalOpen] = useState(false);
    const [isAdministratorsModalOpen, setIsAdministratorsModalOpen] = useState(false);
    const [isQuickUserModalOpen, setIsQuickUserModalOpen] = useState(false);
    const [mandatoAsunto, setMandatoAsunto] = useState('');
    const [mandateData, setMandateData] = useState<MandateData | null>(null);
    const [isGeneratingMandate, setIsGeneratingMandate] = useState(false);
    const [isClientDetailModalOpen, setIsClientDetailModalOpen] = useState(false);
    const [selectedClientIdForModal, setSelectedClientIdForModal] = useState<string | null>(null);
    const [tasks] = useState<Task[]>(propTasks || []);

    // State for prefix selection (only for new cases)
    const [selectedPrefix, setSelectedPrefix] = useState<string>('');
    const [showUnsavedModal, setShowUnsavedModal] = useState(false);
    const [pendingAction, setPendingAction] = useState<'new-case-same' | 'new-case-fresh' | null>(null);
    const initialCaseRef = useRef<string>('');

    // Capture initial state for change detection
    const getCurrentState = useCallback(() => {
        return JSON.stringify({
            client,
            clienteId,
            clientSnapshot,
            vehicle,
            economicData,
            communications,
            attachments,
            fileConfig,
            description,
            caseStatus,
            tasks,
            movimientos
        });
    }, [client, clienteId, clientSnapshot, vehicle, economicData, communications, attachments, fileConfig, description, caseStatus, tasks, movimientos]);

    useEffect(() => {
        if (!initialCaseRef.current && client.id) {
            initialCaseRef.current = getCurrentState();
        }
    }, [client.id, getCurrentState]);

    // Update initial ref when explicitly saved or loaded
    useEffect(() => {
        initialCaseRef.current = getCurrentState();
    }, [fileNumber]);

    const handleNewCaseSameClick = () => {
        const hasChanges = initialCaseRef.current !== getCurrentState();
        if (hasChanges) {
            setPendingAction('new-case-same');
            setShowUnsavedModal(true);
        } else {
            onNewCaseSameClient?.();
        }
    };

    const handleNewCaseDifferentClick = () => {
        const hasChanges = initialCaseRef.current !== getCurrentState();
        if (hasChanges) {
            setPendingAction('new-case-fresh');
            setShowUnsavedModal(true);
        } else {
            onNewCaseDifferentClient?.();
        }
    };

    const handleCloseClick = () => {
        const hasChanges = initialCaseRef.current !== getCurrentState();
        if (hasChanges) {
            setPendingAction(null);
            setShowUnsavedModal(true);
        } else {
            onReturnToDashboard();
        }
    };

    // Load prefixes for new case and set defaults
    useEffect(() => {
        if (fileNumber === 'new') {
            const loadPrefixes = async () => {
                const prefixes = await getPrefixes();

                let defaultPrefix = '';

                // 1. If duplication, use original prefix
                if (duplicateOf) {
                    const sourceCase = caseHistory.find(c => c.fileNumber === duplicateOf);
                    if (sourceCase) {
                        const sourcePrefix = sourceCase.fileNumber.split('-').slice(0, -1).join('-');
                        if (prefixes.some(p => p.code === sourcePrefix)) {
                            defaultPrefix = sourcePrefix;
                        }
                    }
                }

                // 2. Fallback to last used or first available
                if (!defaultPrefix) {
                    const lastUsed = localStorage.getItem('lastUsedPrefix');
                    defaultPrefix = prefixes.find(p => p.code === lastUsed)
                        ? lastUsed!
                        : prefixes[0]?.code || 'EXP';
                }

                setSelectedPrefix(defaultPrefix);
            };
            loadPrefixes();

            // Set default responsible and opening date for new cases
            if (!fileConfig.responsibleUserId || !fileConfig.openingDate) {
                const isCurrentUserGestor = users.some(u => u.id === currentUser!.id);
                const defaultRespId = isCurrentUserGestor
                    ? currentUser!.id
                    : (appSettings?.defaultResponsibleId || '');

                onFileConfigChange({
                    ...fileConfig,
                    responsibleUserId: fileConfig.responsibleUserId || defaultRespId,
                    openingDate: fileConfig.openingDate || new Date().toISOString(),
                    status: fileConfig.status || (appSettings?.defaultInitialStatus || 'Pendiente Documentación')
                });
            }

            // Also update caseStatus state
            if (!caseStatus) {
                setCaseStatus(appSettings?.defaultInitialStatus || 'Pendiente Documentación');
            }
        }
    }, [fileNumber, currentUser, fileConfig, onFileConfigChange, appSettings]);

    const availableStatuses = (appSettings?.caseStatuses && appSettings.caseStatuses.length > 0) ? appSettings.caseStatuses : DEFAULT_CASE_STATUSES;

    // Validate Responsible and Status when duplicating
    useEffect(() => {
        if (fileNumber === 'new' && duplicateOf) {
            let updates: Partial<FileConfig> = {};
            let needsToast = false;
            let messages: string[] = [];

            // 1. Validate Responsible
            if (fileConfig.responsibleUserId) {
                const respExists = users.some(u => u.id === fileConfig.responsibleUserId);
                if (!respExists) {
                    updates.responsibleUserId = appSettings?.defaultResponsibleId || currentUser!.id || '';
                    messages.push('gestor original no disponible');
                    needsToast = true;
                }
            }

            // 2. Validate Status
            if (caseStatus) {
                const statusExists = availableStatuses.includes(caseStatus);
                if (!statusExists) {
                    const defaultStatus = appSettings?.defaultInitialStatus || 'Pendiente Documentación';
                    setCaseStatus(defaultStatus as CaseStatus);
                    messages.push('estado original no disponible');
                    needsToast = true;
                }
            }

            if (Object.keys(updates).length > 0) {
                onFileConfigChange({ ...fileConfig, ...updates });
            }

            if (needsToast) {
                toast.warn(`Ajustes automáticos al duplicar: ${messages.join(', ')}.`);
            }
        }
    }, [fileNumber, duplicateOf, users, appSettings, availableStatuses, onFileConfigChange, currentUser, caseStatus, setCaseStatus]);

    const isLegalEntity = (nif: string): boolean => {
        if (!nif || nif.length < 1) return false;
        const firstChar = nif.charAt(0).toUpperCase();
        return /^[ABCDEFGHJNPQRSUVW]/.test(firstChar);
    };

    const handleUpdateClientWithSync = useCallback(async (updatedClient: Client) => {
        setClient(updatedClient);
        if (isLegalEntity(updatedClient.nif || '') && (updatedClient.nif?.length || 0) >= 9) {
            const existingClient = savedClients.find(c => (c.nif || '').toUpperCase() === (updatedClient.nif || '').toUpperCase());
            if (existingClient) {
                const syncedClient = { ...existingClient, administrators: updatedClient.administrators };
                await saveClient(syncedClient);
                toast.success('Administradores sincronizados.');
            }
        }
    }, [savedClients, saveClient, setClient, toast]);

    const predictedFileNumber = useMemo(() => {
        if (fileNumber !== 'new') return fileNumber;
        if (!caseHistory || caseHistory.length === 0) return `${selectedPrefix || 'EXP'}-0001`;

        // Filter cases with the same prefix and find max number
        const prefix = selectedPrefix || 'EXP';
        const casesWithPrefix = caseHistory.filter(c => c.fileNumber.startsWith(prefix + '-'));
        const allNumbers = casesWithPrefix
            .map(c => {
                const match = c.fileNumber.match(/-(\d+)$/);
                return match ? parseInt(match[1], 10) : 0;
            })
            .filter(num => num > 0);
        const maxNumber = allNumbers.length === 0 ? 0 : Math.max(...allNumbers);
        return `${prefix}-${String(maxNumber + 1).padStart(4, '0')}`;
    }, [fileNumber, caseHistory, selectedPrefix]);

    // Save selected prefix to localStorage when it changes
    useEffect(() => {
        if (fileNumber === 'new' && selectedPrefix) {
            localStorage.setItem('lastUsedPrefix', selectedPrefix);
        }
    }, [selectedPrefix, fileNumber]);

    const handleOpenMandatoModal = () => {
        const defaultAsunto = `${fileConfig.fileType.toUpperCase()}`;
        setMandatoAsunto(defaultAsunto);
        if (appSettings) {
            const data = prepareMandateData(client, defaultAsunto, '', appSettings);
            setMandateData(data);
        }
        setIsMandatoModalOpen(true);
    };

    const handleGenerateMandato = async (asuntoLinea1: string, asuntoLinea2: string, selectedAdminId?: string) => {
        if (!currentUser || !appSettings) return;
        setIsGeneratingMandate(true);
        try {
            let selectedAdmin: Administrator | undefined;
            if (selectedAdminId && client.administrators) {
                selectedAdmin = client.administrators.find(a => a.id === selectedAdminId);
            }
            const data = prepareMandateData(client, asuntoLinea1, asuntoLinea2, appSettings, selectedAdmin);
            if (!data) {
                toast.error('Configuración mandatario incompleta.');
                return;
            }
            const fileName = generateMandateFileName(`${client.firstName} ${client.surnames}`, fileNumber === 'new' ? predictedFileNumber : fileNumber);
            const pdfBlob = await generateMandatePDF('mandate-content', fileName);
            const storageRef = ref(storage, `mandates/${fileNumber}/${fileName}`);
            await uploadBytes(storageRef, pdfBlob);
            const downloadURL = await getDownloadURL(storageRef);
            const newAttachment = {
                id: `mandate-${Date.now()}`,
                name: fileName,
                type: 'application/pdf',
                size: pdfBlob.size,
                status: 'synced' as const,
                url: downloadURL,
                createdAt: new Date().toISOString(),
            };
            setAttachments(prev => [...prev, newAttachment]);
            toast.success('Mandato generado correctamente');
            setIsMandatoModalOpen(false);
        } catch (error) {
            toast.error('Error al generar el mandato');
        } finally {
            setIsGeneratingMandate(false);
        }
    };


    const handleRegisterPayment = (payment: Partial<EconomicLineItem>) => {
        const completePayment: EconomicLineItem = {
            id: payment.id || `payment-${Date.now()}`,
            conceptId: payment.conceptId || '',
            concept: payment.concept || '',
            type: payment.type || 'honorario',
            amount: payment.amount ?? 0,
            date: payment.date || new Date().toISOString()
        };
        setEconomicData(prev => ({
            ...prev,
            lines: [...prev.lines, completePayment]
        }));
        toast.success('Pago registrado correctamente');
    };

    const currentCaseDataForModal: CaseRecord = {
        fileNumber, client, vehicle, fileConfig, economicData, communications,
        attachments, status: caseStatus, tasks: propTasks || [],
        movimientos,
        description,
        createdAt,
        updatedAt: new Date().toISOString(),
    };

    if (!currentUser) return null;

    const handleQuickUserSave = async (newUser: any) => {
        await saveUser(newUser);
        onFileConfigChange({
            ...fileConfig,
            responsibleUserId: newUser.id
        });
        toast.success(`Gestor ${newUser.name} creado y asignado`);
    };



    const managerName = useMemo(() => {
        if (!fileConfig?.responsibleUserId) return undefined;
        const user = users.find(u => u.id === fileConfig.responsibleUserId);
        return user ? user.name : undefined;
    }, [users, fileConfig?.responsibleUserId]);

    const shouldShowVehicleSection = useMemo(() => {
        const normalize = (value?: string) => (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const normalizedCategory = normalize(fileConfig?.category);
        const currentPrefix = fileNumber === 'new'
            ? selectedPrefix
            : (fileNumber || '').split('-').slice(0, -1).join('-');
        const normalizedPrefix = normalize(currentPrefix);
        const normalizedFileType = (fileConfig?.fileType || '').toUpperCase();

        const isLegacyMatPrefix =
            normalizedCategory === 'GEMAT' ||
            normalizedCategory === 'GERMAC' ||
            normalizedPrefix === 'GEMAT' ||
            normalizedPrefix === 'GERMAC';

        const isMatFlowByType = ['MATRICUL', 'TRANSFER', 'DUPLIC', 'IMPORT', 'BAJA', 'TRAFICO', 'DGT']
            .some(token => normalizedFileType.includes(token));

        const hasVehicleData = Boolean(
            vehicle?.vin ||
            (vehicle as any)?.plate ||
            vehicle?.brand ||
            vehicle?.model ||
            vehicle?.engineSize
        );

        return isLegacyMatPrefix || isMatFlowByType || hasVehicleData;
    }, [fileConfig?.category, fileConfig?.fileType, fileNumber, selectedPrefix, vehicle]);

    const handleSaveAndClose = useCallback(async () => {
        if (isSaving) return;
        const success = await onSave(tasks, fileNumber === 'new' ? predictedFileNumber : undefined);
        if (success) {
            initialCaseRef.current = getCurrentState();
            onReturnToDashboard();
        }
    }, [isSaving, onSave, tasks, fileNumber, predictedFileNumber, getCurrentState, onReturnToDashboard]);

    const handleSaveAndCreateNew = useCallback(async () => {
        if (isSaving) return;
        const success = await onSave(tasks, fileNumber === 'new' ? predictedFileNumber : undefined);
        if (success) {
            initialCaseRef.current = getCurrentState();
            onNewCaseSameClient?.();
        }
    }, [isSaving, onSave, tasks, fileNumber, predictedFileNumber, getCurrentState, onNewCaseSameClient]);

    const handleSaveAndCreateNewDifferentClient = useCallback(async () => {
        if (isSaving) return;
        const success = await onSave(tasks, fileNumber === 'new' ? predictedFileNumber : undefined);
        if (success) {
            initialCaseRef.current = getCurrentState();
            onNewCaseDifferentClient?.();
        }
    }, [isSaving, onSave, tasks, fileNumber, predictedFileNumber, getCurrentState, onNewCaseDifferentClient]);

    useEffect(() => {
        const handleKeyboardShortcuts = (event: KeyboardEvent) => {
            const isMod = event.ctrlKey || event.metaKey;
            if (!isMod) return;

            const key = event.key.toLowerCase();
            if (key === 'enter') {
                event.preventDefault();
                void handleSaveAndClose();
                return;
            }

            if (key === 'n') {
                event.preventDefault();
                if (event.shiftKey) {
                    void handleSaveAndCreateNewDifferentClient();
                } else {
                    void handleSaveAndCreateNew();
                }
            }
        };

        window.addEventListener('keydown', handleKeyboardShortcuts);
        return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
    }, [handleSaveAndClose, handleSaveAndCreateNew, handleSaveAndCreateNewDifferentClient]);

    return (
        <>
            {/* Print View (Visible only when printing) */}
            <div id="print-root" className="hidden print:block">
                <CasePrintView
                    caseData={currentCaseDataForModal}
                    fullFileNumber={fileNumber === 'new' ? predictedFileNumber : fileNumber}
                    managerName={managerName}
                />
            </div>

            {/* Screen View (Hidden when printing) */}
            <div className="flex h-screen bg-[#fcfdfe] font-sans overflow-hidden print:hidden">
                {/* Main Central View (Scrollable) */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    {/* Control Bar (Sticky) */}
                    <HeaderSticky
                        fullFileNumber={fileNumber === 'new' ? predictedFileNumber : fileNumber}
                        caseStatus={caseStatus}
                        setCaseStatus={setCaseStatus}
                        availableStatuses={availableStatuses}
                        responsibleUserId={fileConfig.responsibleUserId}
                        onResponsibleChange={(uid) => onFileConfigChange({ ...fileConfig, responsibleUserId: uid })}
                        openingDate={fileConfig.openingDate || new Date().toISOString()}
                        onOpeningDateChange={(d) => onFileConfigChange({ ...fileConfig, openingDate: d })}
                        users={users}
                        saldo={`${economicData.totalAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`}
                        isSaving={isSaving}
                        hasUnsavedChanges={initialCaseRef.current !== getCurrentState()}
                        onSave={handleSaveAndClose}
                        onPrint={() => window.print()}
                        onClose={handleCloseClick}
                        onToggleClose={async () => {
                            const newStatus = caseStatus.toLowerCase().includes('cerrado') ? 'Iniciado' : 'Cerrado';
                            setCaseStatus(newStatus);
                            onFileConfigChange({ ...fileConfig, status: newStatus });
                        }}
                        onAddResponsible={() => setIsQuickUserModalOpen(true)}
                        duplicateOf={duplicateOf ?? undefined}
                        onNewCaseSameClient={handleNewCaseSameClick}
                        onNewCaseDifferentClient={handleNewCaseDifferentClick}
                        showNewCaseActions={false}
                    />

                    {/* Content Area */}
                    <div className="flex-1 overflow-y-auto bg-slate-50/30 no-scrollbar">
                        <div className="max-w-4xl mx-auto px-8 py-10 space-y-12">

                            {/* 1. Cliente / Titular */}
                            <section id="cliente">
                                <ClientCard
                                    client={client}
                                    setClient={setClient}
                                    savedClients={savedClients}
                                    clientSnapshot={clientSnapshot}
                                    clienteId={clienteId}
                                    onViewClient={(id) => {
                                        setSelectedClientIdForModal(id);
                                        setIsClientDetailModalOpen(true);
                                    }}
                                />
                            </section>

                            {/* 2. Observaciones / Resumen del Expediente (Compact) */}
                            <section id="observaciones" className="bg-white rounded-3xl px-8 py-5 border border-slate-100 transition-all duration-300 shadow-sm hover:shadow-md">
                                <div className="flex items-center gap-6">
                                    <div className="flex items-center gap-3 shrink-0">
                                        <div className="p-2 bg-slate-50 text-slate-500 rounded-lg">
                                            <StickyNote size={18} />
                                        </div>
                                        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Observaciones</h3>
                                    </div>
                                    <textarea
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        placeholder="Escribe el concepto u observaciones del expediente..."
                                        rows={1}
                                        className="flex-1 bg-slate-50/50 border-none rounded-xl px-4 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-300 focus:bg-white focus:ring-4 focus:ring-sky-50 transition-all outline-none resize-none leading-tight"
                                    />
                                </div>
                            </section>

                            {/* 3. Datos del Vehículo (compatibilidad con prefijos GE-MAT/GEMAT/GERMAC y casos legacy) */}
                            {shouldShowVehicleSection && (
                                <section id="vehiculo">
                                    <VehicleDataSection
                                        vehicle={vehicle}
                                        setVehicle={setVehicle}
                                        fileType={fileConfig.fileType}
                                        onBatchProcess={onBatchVehicleProcessing}
                                        isBatchProcessing={isBatchProcessing}
                                        onDocumentProcessed={(f) => onAddDocuments([f])}
                                        onGenerateMandate={handleOpenMandatoModal}
                                        onIntegrateHermes={() => setIsHermesModalOpen(true)}
                                    />
                                </section>
                            )}

                            {/* 4. Datos Económicos (New Movements System) */}
                            <section id="pagos">
                                <EconomicMovementsSection
                                    caseRecord={currentCaseDataForModal}
                                    onChange={setMovimientos}
                                />
                            </section>



                            {/* 6. Comunicaciones (Always Visible) */}
                            <section id="comunicaciones">
                                <CommunicationsSection
                                    communications={communications}
                                    setCommunications={setCommunications}
                                    currentUser={currentUser}
                                    users={users}
                                />
                            </section>

                            {/* 7. Documentos Adjuntos (Always Visible) */}
                            <section id="documentos">
                                <AttachedDocumentsSection
                                    attachments={attachments}
                                    onOpen={() => setIsDocumentsModalOpen(true)}
                                    onAddDocuments={onAddDocuments}
                                />
                            </section>
                        </div>
                    </div>
                </div>


                {/* Global Modals */}
                {isSettingsModalOpen && <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />}
                {isHermesModalOpen && <HermesConfigModal isOpen={isHermesModalOpen} onClose={() => setIsHermesModalOpen(false)} caseRecord={currentCaseDataForModal} />}
                {isDocumentsModalOpen && <AttachedDocumentsModal isOpen={isDocumentsModalOpen} onClose={() => setIsDocumentsModalOpen(false)} attachments={attachments} setAttachments={setAttachments} onAddDocuments={onAddDocuments} fileNumber={fileNumber} />}
                {isRegisterPaymentModalOpen && (
                    <RegisterPaymentModal
                        isOpen={isRegisterPaymentModalOpen}
                        onClose={() => setIsRegisterPaymentModalOpen(false)}
                        onRegister={handleRegisterPayment}
                    />
                )}
                {isClientDetailModalOpen && (
                    <ClientDetailModal
                        clientId={selectedClientIdForModal}
                        onClose={() => setIsClientDetailModalOpen(false)}
                        onSelectClient={(id) => setSelectedClientIdForModal(id)}
                        onSaved={() => {
                            // Optionally refresh client data in the current view if needed
                            setIsClientDetailModalOpen(false);
                        }}
                    />
                )}
                {isMandatoModalOpen && mandateData && (
                    <GenerateMandateModal
                        isOpen={isMandatoModalOpen}
                        onClose={() => setIsMandatoModalOpen(false)}
                        client={client}
                        clientSnapshot={clientSnapshot}
                        fileNumber={fileNumber === 'new' ? predictedFileNumber : fileNumber}
                        defaultAsunto={mandatoAsunto}
                        mandateData={mandateData}
                        onGenerate={handleGenerateMandato}
                        isGenerating={isGeneratingMandate}
                    />
                )}
                {isAdministratorsModalOpen && (
                    <AdministratorsModal
                        isOpen={isAdministratorsModalOpen}
                        onClose={() => setIsAdministratorsModalOpen(false)}
                        client={client}
                        onUpdateClient={handleUpdateClientWithSync}
                    />
                )}
                {isQuickUserModalOpen && (
                    <QuickUserModal
                        isOpen={isQuickUserModalOpen}
                        onClose={() => setIsQuickUserModalOpen(false)}
                        onSave={handleQuickUserSave}
                    />
                )}

                <ConfirmationModal
                    isOpen={showUnsavedModal}
                    title="Cambios sin guardar"
                    message="Has realizado cambios en este expediente. ¿Deseas guardarlos antes de salir para no perder la información?"
                    confirmText="Guardar y salir"
                    secondaryText="Descartar y salir"
                    cancelText="Seguir editando"
                    variant="primary"
                    onClose={() => setShowUnsavedModal(false)}
                    onConfirm={async () => {
                        const success = await onSave(tasks, fileNumber === 'new' ? predictedFileNumber : undefined);
                        if (success) {
                            setShowUnsavedModal(false);
                            if (pendingAction === 'new-case-same') {
                                onNewCaseSameClient?.();
                            } else if (pendingAction === 'new-case-fresh') {
                                onNewCaseDifferentClient?.();
                            } else {
                                onReturnToDashboard();
                            }
                        }
                    }}
                    secondaryAction={() => {
                        setShowUnsavedModal(false);
                        if (pendingAction === 'new-case-same') {
                            onNewCaseSameClient?.();
                        } else if (pendingAction === 'new-case-fresh') {
                            onNewCaseDifferentClient?.();
                        } else {
                            onReturnToDashboard();
                        }
                    }}
                />
            </div>
        </>
    );
};


export default CaseDetailView;
