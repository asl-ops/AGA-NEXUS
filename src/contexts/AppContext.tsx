

import React, { createContext, useState, useCallback, useEffect, ReactNode, useContext } from 'react';
import { CaseRecord, Client, User, EconomicTemplates, AppSettings, Vehicle, DEFAULT_THEME } from '@/types';
import * as db from '@/services/firestoreService';
import { getUsers, saveUser as apiSaveUser } from '@/services/userService';
import { initializeAuth, signInWithGoogleInteractive } from '@/services/firebase';
import { useToast } from '@/hooks/useToast';


interface AppContextType {
  caseHistory: CaseRecord[];
  savedClients: Client[];
  savedVehicles: Vehicle[];
  users: User[];
  currentUser: User | null;
  appSettings: AppSettings | null;
  economicTemplates: EconomicTemplates;
  isLoading: boolean;
  initializationError: string | null;
  requiresManualGoogleLogin: boolean;

  setCurrentUser: (user: User) => void;
  retryInitialization: () => Promise<void>;
  loginWithGooglePopup: () => Promise<void>;
  saveCase: (caseRecord: CaseRecord) => Promise<{ success: boolean; isNew?: boolean; }>;
  deleteCase: (fileNumber: string) => Promise<void>;
  saveClient: (client: Client) => Promise<void>;
  deleteClient: (clientId: string) => Promise<void>;
  saveVehicle: (vehicle: Vehicle) => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
  updateEconomicTemplates: (templates: EconomicTemplates) => Promise<void>;
  updateCaseHistory: (updatedHistory: CaseRecord[]) => void;
  saveMultipleCases: (newCases: CaseRecord[]) => Promise<CaseRecord[] | null>;
  saveUser: (user: User) => Promise<void>;
}

export const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { addToast } = useToast();

  const [caseHistory, setCaseHistory] = useState<CaseRecord[]>([]);
  const [savedClients, setSavedClients] = useState<Client[]>([]);
  const [savedVehicles, setSavedVehicles] = useState<Vehicle[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [economicTemplates, setEconomicTemplates] = useState<EconomicTemplates>({});
  const [isLoading, setIsLoading] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [requiresManualGoogleLogin, setRequiresManualGoogleLogin] = useState(false);

  const loadInitialData = useCallback(async () => {
      setIsLoading(true);
      setInitializationError(null);
      setRequiresManualGoogleLogin(false);
      try {
        // 1. Cargar Usuarios (Mock local, siempre funciona)
        const userList = await getUsers();
        setUsers(userList);
        setCurrentUser(userList[0] || null);

        // 2. Intentar conexión Firebase
        await initializeAuth();

        const [settings, templates] = await Promise.all([
          db.getSettings(),
          db.getEconomicTemplates(),
        ]);

        // Carga diferida de expedientes: el explorador consulta bajo demanda.
        setCaseHistory([]);
        setSavedClients([]);
        setSavedVehicles([]);
        setAppSettings(settings);
        setEconomicTemplates(templates);

        // Carga pesada no bloqueante (clientes/vehículos) en segundo plano.
        window.setTimeout(() => {
          void (async () => {
            try {
              const [clients, vehicles] = await Promise.all([
                db.getSavedClients(),
                db.getSavedVehicles(),
              ]);
              setSavedClients(clients);
              setSavedVehicles(vehicles);
            } catch (backgroundError) {
              console.warn('Background load (clients/vehicles) failed:', backgroundError);
            }
          })();
        }, 0);

      } catch (error: any) {
        console.error("Error loading initial data:", error);

        if (error.code === 'auth/redirecting') {
          setInitializationError("Redirigiendo a Google para iniciar sesión...");
          return;
        }

        if (error.code === 'auth/login-required') {
          setInitializationError("Debes iniciar sesión con tu cuenta corporativa.");
          setRequiresManualGoogleLogin(true);
          return;
        }

        if (error.code === 'auth/invalid-domain') {
          setInitializationError("Acceso denegado: usa tu cuenta corporativa @gestoria-arcos.com.");
          return;
        }

        if (error.code === 'auth/redirect-failed') {
          setInitializationError("No se pudo completar el login automático en este navegador.");
          setRequiresManualGoogleLogin(true);
          return;
        }

        // Si falla Firebase, inicializamos con valores vacíos para que la APP funcione
        setCaseHistory([]);
        setSavedClients([]);
        setSavedVehicles([]);
        setEconomicTemplates({});

        // Configuración por defecto en memoria si falla DB
        setAppSettings({
          fileCounter: 1,
          generalSavePath: 'C:\\',
          mandatoBody: '',
          agency: {
            name: 'Gestoría',
            cif: '',
            address: '',
            managerName: '',
            managerColegiado: '',
            managerDni: ''
          },
          fieldConfigs: { 'GE-MAT': [], 'FI-TRI': [], 'FI-CONTA': [] },
          caseStatuses: ['Pendiente', 'Finalizado'],
          fileTypes: { 'GE-MAT': ['General'], 'FI-TRI': ['General'], 'FI-CONTA': ['General'] }
        });

        if (error.code === 'permission-denied') {
          setInitializationError("Error de permisos: No tienes acceso a la base de datos. Se ha cargado el modo offline.");
        } else if (error.code?.includes('auth')) {
          setInitializationError("Error de autenticación. Debes iniciar sesión con tu cuenta corporativa.");
        } else {
          setInitializationError("No se pudo conectar con la base de datos. Verifica tu conexión o configuración.");
        }
      } finally {
        setIsLoading(false);
      }
  }, []);

  useEffect(() => {
    void loadInitialData();
    return () => undefined;
  }, [loadInitialData]);

  const retryInitialization = useCallback(async () => {
    await loadInitialData();
  }, [loadInitialData]);

  const loginWithGooglePopup = useCallback(async () => {
    setIsLoading(true);
    try {
      await signInWithGoogleInteractive();
      await loadInitialData();
    } catch (error: any) {
      if (error?.code === 'auth/invalid-domain') {
        setInitializationError("Acceso denegado: usa tu cuenta corporativa @gestoria-arcos.com.");
      } else {
        setInitializationError("No se pudo abrir el login con Google. Revisa bloqueadores de popups y vuelve a intentar.");
      }
      setRequiresManualGoogleLogin(true);
    } finally {
      setIsLoading(false);
    }
  }, [loadInitialData]);

  // Efecto para aplicar tema visual
  useEffect(() => {
    const theme = appSettings?.uiTheme || DEFAULT_THEME;
    const root = document.documentElement;

    // Mapeo de pesos a valores CSS
    const weightMap: Record<string, string> = {
      'font-normal': '400',
      'font-medium': '500',
      'font-semibold': '600',
      'font-bold': '700'
    };

    root.style.setProperty('--corporate-accent', theme.corporateAccent);
    root.style.setProperty('--label-text-color', theme.labelTextColor);
    root.style.setProperty('--value-text-color', theme.valueTextColor);
    root.style.setProperty('--label-weight', weightMap[theme.labelWeight] || '400');
    root.style.setProperty('--value-weight', weightMap[theme.valueWeight] || '400');
    root.style.setProperty('--divider-color', theme.dividerColor);
    root.style.setProperty('--divider-opacity', theme.dividerOpacity.toString());
    root.style.setProperty('--active-tab-indicator-color', theme.activeTabIndicatorColor);
    root.style.setProperty('--active-tab-indicator-height', `${theme.activeTabIndicatorHeight}px`);
    root.style.setProperty('--active-tab-indicator-radius', `${theme.activeTabIndicatorRadius}px`);
  }, [appSettings?.uiTheme]);

  const saveCase = useCallback(async (caseRecord: CaseRecord) => {
    try {
      const { isNew, updatedHistory } = await db.saveOrUpdateCase(caseRecord);
      setCaseHistory(updatedHistory);
      addToast(`Expediente ${caseRecord.fileNumber} ${isNew ? 'guardado' : 'actualizado'}.`, 'success');
      return { success: true, isNew };
    } catch (error) {
      addToast('Error al guardar. Verifica tu conexión.', 'error');
      console.error(error);
      return { success: false };
    }
  }, [addToast]);

  const deleteCase = useCallback(async (fileNumber: string) => {
    try {
      const updatedHistory = await db.deleteCase(fileNumber);
      setCaseHistory(updatedHistory);
      addToast(`Expediente ${fileNumber} eliminado.`, 'success');
    } catch (error) {
      addToast('Error al eliminar el expediente.', 'error');
    }
  }, [addToast]);

  const saveClient = useCallback(async (client: Client) => {
    try {
      const updatedClients = await db.saveOrUpdateClient(client);
      setSavedClients(updatedClients);
      addToast(`Cliente "${client.surnames}" guardado.`, 'success');
    } catch (error) {
      addToast('Error al guardar el cliente.', 'error');
    }
  }, [addToast]);

  const deleteClient = useCallback(async (clientId: string) => {
    try {
      const updatedClients = await db.deleteClient(clientId);
      setSavedClients(updatedClients);
      addToast('Cliente eliminado.', 'success');
    } catch (error) {
      addToast('Error al eliminar el cliente.', 'error');
    }
  }, [addToast]);

  const saveVehicle = useCallback(async (vehicle: Vehicle) => {
    try {
      const updatedVehicles = await db.saveOrUpdateVehicle(vehicle);
      setSavedVehicles(updatedVehicles);
      addToast(`Vehículo guardado.`, 'success');
    } catch (error) {
      addToast('Error al guardar el vehículo.', 'error');
    }
  }, [addToast]);

  const updateSettings = useCallback(async (settings: Partial<AppSettings>) => {
    try {
      await db.saveSettings(settings);
      setAppSettings(prev => (prev ? { ...prev, ...settings } : null));
      addToast('Configuración guardada.', 'success');
    } catch (error) {
      addToast('Error al guardar la configuración.', 'error');
    }
  }, [addToast]);

  const updateEconomicTemplates = useCallback(async (templates: EconomicTemplates) => {
    try {
      await db.saveEconomicTemplates(templates);
      setEconomicTemplates(templates);
    } catch (error) {
      addToast('Error al guardar las plantillas.', 'error');
    }
  }, [addToast]);

  const saveMultipleCases = useCallback(async (newCases: CaseRecord[]) => {
    try {
      const updatedHistory = await db.saveMultipleCases(newCases);
      setCaseHistory(updatedHistory);
      return updatedHistory;
    } catch (error) {
      addToast('Error al guardar lote.', 'error');
      return null;
    }
  }, [addToast]);


  const saveUser = async (user: User) => {
    try {
      const updatedUsers = await apiSaveUser(user);
      setUsers(updatedUsers);
      addToast('Usuario guardado correctamente', 'success');
    } catch (error) {
      console.error("Error saving user:", error);
      addToast('Error al guardar el usuario', 'error');
    }
  };

  return (
    <AppContext.Provider value={{
      caseHistory,
      savedClients,
      savedVehicles,
      users,
      currentUser,
      appSettings,
      economicTemplates,
      isLoading,
      initializationError,
      requiresManualGoogleLogin,
      setCurrentUser,
      retryInitialization,
      loginWithGooglePopup,
      saveCase,
      deleteCase,
      saveClient,
      deleteClient,
      saveVehicle,
      updateSettings,
      updateEconomicTemplates,
      updateCaseHistory: setCaseHistory,
      saveMultipleCases,
      saveUser,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext debe ser usado dentro de un AppProvider');
  }
  return context;
};
