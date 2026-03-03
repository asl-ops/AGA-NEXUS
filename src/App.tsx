import React, { useEffect, lazy, Suspense } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useAppContext } from '@/contexts/AppContext';
import RemoteAccessInfo from '@/components/RemoteAccessInfo';
import { useCaseManager } from '@/hooks/useCaseManager';
import { useHashRouter } from '@/hooks/useHashRouter';
import { HermesSpinner } from '@/components/ui/HermesSpinner';
import { FileStack, Users, X } from 'lucide-react';

const Dashboard = lazy(() => import('@/components/Dashboard'));
const CaseDetailView = lazy(() => import('@/components/CaseDetailView'));
const ResponsableManager = lazy(() => import('@/components/ResponsableManager'));
const TasksDashboard = lazy(() => import('@/components/TasksDashboard'));
const ClientExplorer = lazy(() => import('@/components/ClientExplorer'));
const AlbaranesExplorer = lazy(() => import('@/components/AlbaranesExplorer'));
const ProformasView = lazy(() => import('@/components/ProformasView'));
const InvoicesView = lazy(() => import('@/components/InvoicesView'));
const CashView = lazy(() => import('@/components/CashView'));
const EconomicView = lazy(() => import('@/components/EconomicView'));
const PreaperturaView = lazy(() => import('@/components/PreaperturaView'));
const Configuration = lazy(() => import('@/components/Configuration'));
const LegacyDashboard = lazy(() => import('@/components/legacy/LegacyDashboard'));
const ClientBillingPlaceholder = lazy(() => import('./components/ClientBillingPlaceholder'));
const MainNavigationHub = lazy(() => import('@/components/MainNavigationHub').then(module => ({ default: module.MainNavigationHub })));
import NewCaseWizard from '@/components/NewCaseWizard';
import { ModuleInDevelopmentNotice } from '@/components/ui/ModuleInDevelopmentNotice';
import { Task } from '@/types';
import { getViewMode, VIEW_MODE_CHANGED_EVENT, ViewMode } from '@/services/viewModeService';


interface VisualSettings {
  intensity: number; // 0-100 (saturación)
  contrast: number;  // 0-100 (ajuste sidebar/bg)
  relief: number;    // 0-100 (bordes/sombras)
  mode: 'apple' | 'office' | 'dark';
}

const PRESETS: Record<VisualSettings['mode'], VisualSettings> = {
  apple: { mode: 'apple', intensity: 70, contrast: 10, relief: 30 },
  office: { mode: 'office', intensity: 90, contrast: 80, relief: 100 },
  dark: { mode: 'dark', intensity: 50, contrast: 10, relief: 20 },
};

const App: React.FC = () => {
  const {
    caseHistory, appSettings, currentUser, isLoading, initializationError, requiresManualGoogleLogin,
    retryInitialization, loginWithGooglePopup,
    deleteClient, users
  } = useAppContext();
  const { currentView, fileNumberParam, navigateTo, duplicateOf } = useHashRouter();
  const [isNewCaseWizardOpen, setIsNewCaseWizardOpen] = React.useState(false);
  const [initialPrefixId, setInitialPrefixId] = React.useState<string | undefined>(undefined);
  const [initialClientId, setInitialClientId] = React.useState<string | undefined>(undefined);
  const [forceBlankClientSelection, setForceBlankClientSelection] = React.useState(false);

  // 🎨 Theme Engine State
  const [visualSettings, setVisualSettings] = React.useState<VisualSettings>(() => {
    const saved = localStorage.getItem('ge_visual_settings');
    if (saved) return JSON.parse(saved);
    return PRESETS.apple;
  });

  const [isThemeModalOpen, setIsThemeModalOpen] = React.useState(false);
  const [viewMode, setViewModeState] = React.useState<ViewMode>(getViewMode());
  const appStartMarkedRef = React.useRef(false);
  const appReadyMarkedRef = React.useRef(false);

  // Reset indicator
  const isModified = React.useMemo(() => {
    const base = PRESETS[visualSettings.mode];
    return visualSettings.intensity !== base.intensity ||
      visualSettings.contrast !== base.contrast ||
      visualSettings.relief !== base.relief;
  }, [visualSettings]);

  // Apply Theme to DOM
  useEffect(() => {
    const root = document.documentElement;
    const { intensity, contrast, relief, mode } = visualSettings;

    root.style.setProperty('--theme-h', '212');
    root.style.setProperty('--theme-s', `${intensity}%`);

    // Contrast adjusted for Top Navigation (Header)
    const headerL = mode === 'dark' ? 12 : 100 - (contrast * 0.05);
    root.style.setProperty('--sidebar-l', `${headerL}%`);
    root.style.setProperty('--bg-l', `${mode === 'dark' ? 8 : 98}%`);

    root.style.setProperty('--border-opacity', `${(relief / 100) * 0.3}`);
    root.style.setProperty('--shadow-opacity', `${(relief / 100) * 0.15}`);

    // Text Contrast Logic
    root.style.setProperty('--active-text', headerL < 60 ? '#FFFFFF' : 'var(--primary)');
    root.style.setProperty('--active-accent', headerL < 60 ? 'hsl(212, 100%, 75%)' : 'var(--primary)');

    localStorage.setItem('ge_visual_settings', JSON.stringify(visualSettings));
  }, [visualSettings]);

  useEffect(() => {
    const syncViewMode = (event: Event) => {
      const customEvent = event as CustomEvent<ViewMode>;
      if (customEvent.detail === 'menu' || customEvent.detail === 'cards') {
        setViewModeState(customEvent.detail);
        return;
      }
      setViewModeState(getViewMode());
    };

    window.addEventListener(VIEW_MODE_CHANGED_EVENT, syncViewMode as EventListener);
    window.addEventListener('storage', syncViewMode as EventListener);
    return () => {
      window.removeEventListener(VIEW_MODE_CHANGED_EVENT, syncViewMode as EventListener);
      window.removeEventListener('storage', syncViewMode as EventListener);
    };
  }, []);

  // Prefetch high-traffic modules during idle time to speed up first navigation.
  useEffect(() => {
    const preloadCommonViews = () => {
      void import('@/components/EconomicView');
      void import('@/components/ClientExplorer');
      void import('@/components/InvoicesView');
      void import('@/components/CashView');
      void import('@/components/AlbaranesExplorer');
      void import('@/components/ProformasView');
      void import('@/components/Configuration');
      void import('@/components/MainNavigationHub');
    };

    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof win.requestIdleCallback === 'function') {
      const idleId = win.requestIdleCallback(() => preloadCommonViews(), { timeout: 1400 });
      return () => win.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(preloadCommonViews, 500);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (appStartMarkedRef.current) return;
    performance.mark('app_start');
    appStartMarkedRef.current = true;
  }, []);

  useEffect(() => {
    if (appReadyMarkedRef.current) return;
    if (isLoading || !currentUser || !appSettings) return;
    performance.mark('app_ready');
    performance.measure('app_boot_total', 'app_start', 'app_ready');
    if (import.meta.env.DEV) {
      const entry = performance.getEntriesByName('app_boot_total').at(-1);
      if (entry) {
        console.info(`[perf] app_boot_total=${Math.round(entry.duration)}ms`);
      }
    }
    appReadyMarkedRef.current = true;
  }, [isLoading, currentUser, appSettings]);

  const {
    client, setClient,
    clienteId, setClienteId,
    clientSnapshot, setClientSnapshot,
    vehicle, setVehicle,
    economicData, setEconomicData,
    communications, setCommunications,
    attachments, setAttachments,
    fileConfig, handleFileConfigChange,
    description, setDescription,
    caseStatus, setCaseStatus,
    tasks, movimientos, setMovimientos, createdAt,
    isClassifying, isBatchProcessing, isSaving,
    clearForm, loadCaseData, handleSaveAndReturn, handleAddDocuments,
    handleUpdateTaskStatus
  } = useCaseManager();

  const [isRemoteAccessModalOpen, setIsRemoteAccessModalOpen] = React.useState(false);


  const loadedFileNumberRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (currentView === 'detail') {
      if (fileNumberParam && fileNumberParam !== 'new') {
        if (loadedFileNumberRef.current !== fileNumberParam) {
          const caseToLoad = caseHistory.find(c => c.fileNumber === fileNumberParam);
          if (caseToLoad) {
            console.log('📬 Cargando datos del expediente:', fileNumberParam);
            loadCaseData(caseToLoad);
            loadedFileNumberRef.current = fileNumberParam;
          } else {
            console.log('🔎 Expediente no encontrado en historial local, intentando carga directa:', fileNumberParam);
            import('@/services/firestoreService').then(async (db) => {
              try {
                const snapshot = await db.getCaseHistory();
                const found = snapshot.find(c => c.fileNumber === fileNumberParam);
                if (found) {
                  loadCaseData(found);
                  loadedFileNumberRef.current = fileNumberParam;
                }
              } catch (e) {
                console.error('Error en carga directa:', e);
              }
            });
          }
        }
      } else if (fileNumberParam === 'new') {
        if (duplicateOf && loadedFileNumberRef.current !== `dup-${duplicateOf}`) {
          const caseToDuplicate = caseHistory.find(c => c.fileNumber === duplicateOf);
          if (caseToDuplicate) {
            console.log('📂 Duplicando expediente para nuevo:', duplicateOf);
            loadCaseData(caseToDuplicate, true);
            loadedFileNumberRef.current = `dup-${duplicateOf}`;
            return;
          }
        }

        if (!duplicateOf && loadedFileNumberRef.current !== 'new') {
          console.log('✨ Inicializando nuevo expediente');
          clearForm();
          loadedFileNumberRef.current = 'new';
        }
      }
    } else {
      loadedFileNumberRef.current = null;
    }
  }, [currentView, fileNumberParam, loadCaseData, clearForm, caseHistory, duplicateOf]);

  const handleSelectCase = (fileNumber: string) => {
    navigateTo(`/detail/${fileNumber}`);
  };

  const handleReturnFromDetail = () => {
    navigateTo('/');
  };

  const handleCreateNewCase = (prefixId?: string, preselectedClientId?: string, forceBlankClient = false) => {
    setInitialPrefixId(prefixId);
    setInitialClientId(preselectedClientId);
    setForceBlankClientSelection(forceBlankClient);
    setIsNewCaseWizardOpen(true);
  };

  const handleSidebarNewSameClient = () => {
    const canReuseCurrentClient = currentView === 'detail' && Boolean(client.id || clienteId);
    if (!canReuseCurrentClient) return;
    handleCreateNewCase(
      getPrefixFromFileNumber(fileNumberParam),
      client.id || clienteId || undefined
    );
  };

  const handleSidebarNewDifferentClient = () => {
    handleCreateNewCase(undefined, undefined, true);
  };

  const canCreateSameClient = currentView === 'detail' && Boolean(client.id || clienteId);

  const getPrefixFromFileNumber = (fileNumber?: string | null): string | undefined => {
    if (!fileNumber || fileNumber === 'new') return undefined;
    const parts = fileNumber.split('-');
    if (parts.length < 2) return undefined;
    return parts.slice(0, -1).join('-');
  };

  const handleWizardCreated = (fileNumber: string) => {
    navigateTo(`/detail/${fileNumber}`);
  };

  const onSaveOnlyWrapper = async (tasks: Task[], forcedFileNumber?: string) => {
    return await handleSaveAndReturn(tasks, forcedFileNumber);
  };

  const loadingFallback = (
    <div className="flex items-center justify-center h-full p-8 min-h-[400px]">
      <HermesSpinner size="lg" label="Cargando..." />
    </div>
  );

  const renderContent = () => {
    if (viewMode === 'cards') {
      return <Suspense fallback={loadingFallback}><MainNavigationHub /></Suspense>;
    }

    switch (currentView) {
      case 'dashboard':
        return <Suspense fallback={loadingFallback}><Dashboard onSelectCase={handleSelectCase} onCreateNewCase={handleCreateNewCase} onShowResponsibleDashboard={() => navigateTo('/responsible')} /></Suspense>;
      case 'tasks':
        return <Suspense fallback={loadingFallback}><TasksDashboard onUpdateTaskStatus={handleUpdateTaskStatus} onGoToCase={(c) => handleSelectCase(c.fileNumber)} onReturnToDashboard={() => navigateTo('/')} /></Suspense>;
      case 'responsible':
        return <Suspense fallback={loadingFallback}><ResponsableManager /></Suspense>;
      case 'clients':
        return <Suspense fallback={loadingFallback}><ClientExplorer onReturnToDashboard={() => navigateTo('/')} /></Suspense>;
      case 'billing':
        return (
          <Suspense fallback={loadingFallback}>
            <div className="flex h-full min-h-0 flex-col">
              <ModuleInDevelopmentNotice
                moduleName="Albaranes"
                message="Este módulo está en evolución. En próximas iteraciones se completará, incluyendo la posibilidad de incorporar albaranes a facturas proforma y a facturas."
              />
              <div className="min-h-0 flex-1">
                <AlbaranesExplorer onReturn={() => navigateTo('/')} />
              </div>
            </div>
          </Suspense>
        );
      case 'proformas':
        return (
          <Suspense fallback={loadingFallback}>
            <div className="flex h-full min-h-0 flex-col">
              <ModuleInDevelopmentNotice moduleName="Proformas" />
              <div className="min-h-0 flex-1">
                <ProformasView />
              </div>
            </div>
          </Suspense>
        );
      case 'invoices':
        return <Suspense fallback={loadingFallback}><InvoicesView /></Suspense>;
      case 'cash':
        return (
          <Suspense fallback={loadingFallback}>
            <div className="flex h-full min-h-0 flex-col">
              <ModuleInDevelopmentNotice moduleName="Caja" />
              <div className="min-h-0 flex-1">
                <CashView />
              </div>
            </div>
          </Suspense>
        );
      case 'preapertura':
        return <Suspense fallback={loadingFallback}><PreaperturaView /></Suspense>;
      case 'client-billing':
        const billingClientId = new URLSearchParams(window.location.hash.split('?')[1]).get('clientId');
        return <Suspense fallback={loadingFallback}><ClientBillingPlaceholder clientId={billingClientId || undefined} onBack={() => navigateTo('/clients')} /></Suspense>;
      case 'economico':
        return <Suspense fallback={loadingFallback}><EconomicView /></Suspense>;
      case 'config':
        return <Suspense fallback={loadingFallback}><Configuration /></Suspense>;
      case 'detail':
        if (!fileNumberParam) return loadingFallback;
        return (
          <Suspense fallback={loadingFallback}>
            <CaseDetailView
              client={client}
              setClient={setClient}
              clienteId={clienteId}
              setClienteId={setClienteId}
              clientSnapshot={clientSnapshot}
              setClientSnapshot={setClientSnapshot}
              vehicle={vehicle}
              setVehicle={setVehicle}
              economicData={economicData}
              setEconomicData={setEconomicData}
              movimientos={movimientos}
              setMovimientos={setMovimientos}
              communications={communications}
              setCommunications={setCommunications}
              attachments={attachments}
              setAttachments={setAttachments}
              tasks={tasks}
              fileConfig={fileConfig}
              onFileConfigChange={handleFileConfigChange}
              fileNumber={fileNumberParam}
              description={description}
              setDescription={setDescription}
              caseStatus={caseStatus}
              setCaseStatus={setCaseStatus}
              onSave={onSaveOnlyWrapper}
              onReturnToDashboard={handleReturnFromDetail}
              onBatchVehicleProcessing={() => { }}
              isBatchProcessing={isBatchProcessing}
              onAddDocuments={handleAddDocuments}
              isClassifying={isClassifying}
              isSaving={isSaving}
              createdAt={createdAt}
              duplicateOf={duplicateOf}
              onDeleteClient={deleteClient}
              onNewCaseSameClient={() => handleCreateNewCase(
                getPrefixFromFileNumber(fileNumberParam),
                client.id || clienteId || undefined
              )}
              onNewCaseDifferentClient={() => handleCreateNewCase(undefined, undefined, true)}
            />
          </Suspense>
        );
      case 'legacy':
        return (
          <Suspense fallback={loadingFallback}>
            <div className="bg-amber-50 border-b border-amber-200 p-2 text-center text-[10px] text-amber-800 sticky top-0 z-[100] uppercase tracking-widest font-normal">
              Versión Legacy (Lectura y consulta para asegurar campos)
              <button
                onClick={() => navigateTo('/')}
                className="ml-4 font-normal underline hover:text-amber-950"
              >
                Volver a la versión nueva
              </button>
            </div>
            <LegacyDashboard onSelectCase={handleSelectCase} onCreateNewCase={handleCreateNewCase} onShowResponsibleDashboard={() => navigateTo('/responsible')} />
          </Suspense>
        );
      default:
        return <p>Vista no reconocida</p>;
    }
  }

  if (initializationError) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="max-w-3xl bg-white p-8 rounded-xl shadow-lg border border-yellow-300">
          <p>{initializationError}</p>
          <div className="mt-6 flex items-center gap-3">
            {requiresManualGoogleLogin ? (
              <button
                type="button"
                onClick={() => void loginWithGooglePopup()}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                Iniciar sesión con Google
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void retryInitialization()}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              Reintentar
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (isLoading || !currentUser || !appSettings) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <HermesSpinner size="xl" label="Cargando aplicación..." />
      </div>
    )
  }

  const getPageTitle = () => {
    switch (currentView) {
      case 'dashboard': return 'Explorador de Expedientes';
      case 'tasks': return 'Mis Tareas';
      case 'responsible': return 'Panel de Responsable';
      case 'clients': return 'Gestión de Clientes';
      case 'billing': return 'Albaranes';
      case 'proformas': return 'Proformas';
      case 'invoices': return 'Facturas';
      case 'economico': return 'Gestión Económica de Clientes';
      case 'cash': return 'Caja Diaria';
      case 'preapertura': return 'Expedientes en preapertura';
      case 'config': return 'Configuración del Sistema';
      case 'detail': return fileNumberParam === 'new' ? 'Nuevo Expediente' : `Expediente ${fileNumberParam}`;
      default: return 'Gestor Pro';
    }
  };

  const appContent = (
    <div className="flex-1 flex flex-col min-w-0">
      <RemoteAccessInfo isOpen={isRemoteAccessModalOpen} onClose={() => setIsRemoteAccessModalOpen(false)} />
      {renderContent()}
    </div>
  );

  if (currentView === 'legacy') {
    return renderContent();
  }

  return (
    <AppShell
      title={getPageTitle()}
      onOpenThemeSettings={() => setIsThemeModalOpen(true)}
      onNewCaseSameClient={handleSidebarNewSameClient}
      onNewCaseDifferentClient={handleSidebarNewDifferentClient}
      canCreateSameClient={canCreateSameClient}
    >
      {appContent}
      <NewCaseWizard
        isOpen={isNewCaseWizardOpen}
        onClose={() => {
          setIsNewCaseWizardOpen(false);
          setInitialClientId(undefined);
          setForceBlankClientSelection(false);
        }}
        onCreated={handleWizardCreated}
        users={users}
        currentUser={currentUser || undefined}
        initialPrefixId={initialPrefixId}
        initialClientId={initialClientId}
        forceBlankClientSelection={forceBlankClientSelection}
      />

      {/* 🎨 THEME ADJUSTMENTS MODAL (PORTED FROM FAC-EXPRESS) */}
      {isThemeModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in" onClick={() => setIsThemeModalOpen(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl p-10 animate-in zoom-in overflow-hidden border border-slate-100">
            <div className="mb-10 flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">
                  {visualSettings.mode === 'apple' ? ' Apple' : visualSettings.mode === 'office' ? '🏢 Oficina' : '🌙 Nocturno'}
                  {isModified && <span className="ml-2 text-[10px] text-sky-600 lowercase font-bold opacity-60">(modificado)</span>}
                </h3>
                <p className="text-xs text-slate-500 opacity-60 font-bold uppercase tracking-widest mt-1">Calibración Expedientes PRO</p>
              </div>
              <div className="flex items-center gap-3">
                {isModified && (
                  <button
                    onClick={() => setVisualSettings(PRESETS[visualSettings.mode])}
                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-sky-600 bg-sky-50 rounded-xl hover:bg-sky-100 transition-all"
                  >
                    Restablecer
                  </button>
                )}
                <button onClick={() => setIsThemeModalOpen(false)} className="p-3 text-slate-400 hover:text-sky-600 transition-colors bg-slate-50 rounded-2xl">
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="space-y-10">
              {/* 💡 Preview (Horizontal active tab style) */}
              <div className="p-8 rounded-[2rem] bg-slate-50/50 border border-slate-100/50 relative overflow-hidden shadow-inner">
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_top_right,var(--primary),transparent)]" />
                <label className="app-label-block mb-6 text-center opacity-40 uppercase tracking-[0.2em] text-[9px]">Simulación Navegación Superior</label>
                <div className="flex gap-4 items-center justify-center relative z-10">
                  <div className="py-2 px-4 rounded-xl bg-[var(--primary)] text-[var(--active-text)] shadow-lg shadow-primary/20 flex items-center gap-2 border-b-2 border-b-[var(--active-accent)]">
                    <FileStack size={12} className="opacity-80" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Activo</span>
                  </div>
                  <div className="py-2 px-4 rounded-xl bg-white/50 text-slate-500 flex items-center gap-2 border border-[rgba(0,0,0,var(--border-opacity))]">
                    <Users size={12} />
                    <span className="text-[10px] font-black uppercase tracking-widest">Inactivo</span>
                  </div>
                </div>
              </div>

              {/* Sliders */}
              <div className="space-y-8">
                <div className="grid grid-cols-3 gap-2">
                  {(['apple', 'office', 'dark'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setVisualSettings(PRESETS[p])}
                      className={`py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${visualSettings.mode === p ? "border-sky-600 bg-sky-600 text-white" : "border-slate-100 text-slate-500 hover:border-sky-300"
                        }`}
                    >
                      {p === 'apple' ? ' Apple' : p === 'office' ? '🏢 Oficina' : '🌙 Nocturno'}
                    </button>
                  ))}
                </div>

                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <label className="app-label">Intensidad Azul</label>
                      <span className="text-[9px] font-black text-sky-600">{visualSettings.intensity}%</span>
                    </div>
                    <input
                      type="range" min="0" max="100"
                      value={visualSettings.intensity}
                      onChange={(e) => setVisualSettings(prev => ({ ...prev, intensity: +e.target.value }))}
                      className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-sky-600"
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <label className="app-label">Brillo Barra Superior</label>
                      <span className="text-[9px] font-black text-sky-600">{visualSettings.contrast}%</span>
                    </div>
                    <input
                      type="range" min="0" max="100"
                      value={visualSettings.contrast}
                      onChange={(e) => setVisualSettings(prev => ({ ...prev, contrast: +e.target.value }))}
                      className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-sky-600"
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <label className="app-label">Relieve de Interfaz</label>
                      <span className="text-[9px] font-black text-sky-600">{visualSettings.relief}%</span>
                    </div>
                    <input
                      type="range" min="0" max="100"
                      value={visualSettings.relief}
                      onChange={(e) => setVisualSettings(prev => ({ ...prev, relief: +e.target.value }))}
                      className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-sky-600"
                    />
                  </div>
                </div>
              </div>

              {/* Export/Import JSON */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(visualSettings, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `expedientes-pro-theme-${visualSettings.mode}.json`;
                    a.click();
                  }}
                  className="flex-1 py-3 px-4 bg-slate-50 text-slate-500 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-100 transition-all text-center"
                >
                  Exportar
                </button>
                <label className="flex-1 py-3 px-4 bg-slate-50 text-slate-500 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-100 transition-all text-center cursor-pointer">
                  Importar
                  <input
                    type="file" accept=".json" className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                          try {
                            const theme = JSON.parse(e.target?.result as string);
                            setVisualSettings(theme);
                          } catch (err) { alert('Archivo inválido'); }
                        };
                        reader.readAsText(file);
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default App;
