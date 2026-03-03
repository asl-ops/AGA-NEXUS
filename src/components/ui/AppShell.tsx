

import React, { ReactNode } from 'react';
import {
    Settings,
    Sparkles,
    Cpu,
    Users,
    FolderKanban,
    ReceiptText,
    FileText,
    Files,
    WalletCards,
    Landmark,
    FolderClock,
    ChevronDown,
    ChevronRight,
    HelpCircle,
    LogOut,
    X,
    Pin
} from 'lucide-react';
import appIcon from '@/assets/icono-as.png';
import { useAppContext } from '../../contexts/AppContext';
import SecureConfirmationModal from '../SecureConfirmationModal';
import { useHashRouter } from '../../hooks/useHashRouter';
import { ViewModeToggle } from './ViewModeToggle';
import { GlobalSearchModal } from '../GlobalSearchModal';
import { setViewMode } from '../../services/viewModeService';
import { navigateToModule } from '@/utils/moduleNavigation';
import { auth } from '@/services/firebase';
import { signOut } from 'firebase/auth';
import { resolveHelpForView } from '@/help/helpResolver';
import { resetSessionContext } from '@/utils/sessionContextReset';
import {
    getIdentifierContextChangedEventName,
    readActiveClientIdentifier,
    readIsIdentifierPinned,
    readPinnedIdentifier,
    unpinClientIdentifier
} from '@/utils/recentClientIdentifiers';
import { ContextHelpDrawer } from './ContextHelpDrawer';
import { usePredictiveHelp } from '@/hooks/usePredictiveHelp';
import { IdentifierSwitcherModal } from './IdentifierSwitcherModal';

interface AppShellProps {
    children: ReactNode;
    title?: string;
    onOpenThemeSettings?: () => void;
    onNewCaseSameClient?: () => void;
    onNewCaseDifferentClient?: () => void;
    canCreateSameClient?: boolean;
}

const APP_NAV_ITEMS = [
    { id: 'clients', label: 'Clientes', path: '/clients', icon: Users },
    { id: 'dashboard', label: 'Expedientes', path: '/', icon: FolderKanban },
    { id: 'preapertura', label: 'Expedientes en preapertura', path: '/preapertura', icon: FolderClock },
    { id: 'billing', label: 'Albaranes', path: '/billing', icon: ReceiptText },
    { id: 'proformas', label: 'Proformas', path: '/proformas', icon: FileText },
    { id: 'invoices', label: 'Facturas', path: '/invoices', icon: Files },
    { id: 'cash', label: 'Caja', path: '/cash', icon: WalletCards },
    { id: 'economico', label: 'Económico', path: '/economico', icon: Landmark },
    { id: 'config', label: 'Administración', path: '/config', icon: Settings },
];
const HELP_SEEN_KEY = 'aga-help-seen-v1';

const AppShell: React.FC<AppShellProps> = ({
    children,
    onOpenThemeSettings,
    onNewCaseSameClient,
    onNewCaseDifferentClient,
    canCreateSameClient = false
}) => {
    const { currentView, navigateTo } = useHashRouter();
    const { appSettings } = useAppContext();
    const [isAdminModalOpen, setIsAdminModalOpen] = React.useState(false);
    const [isSearchModalOpen, setIsSearchModalOpen] = React.useState(false);
    const [isLoggingOut, setIsLoggingOut] = React.useState(false);
    const [isHelpOpen, setIsHelpOpen] = React.useState(false);
    const [activeIdentifier, setActiveIdentifier] = React.useState<string | null>(null);
    const [isPinned, setIsPinned] = React.useState(false);
    const [pinnedIdentifier, setPinnedIdentifier] = React.useState<string | null>(null);
    const [isIdentifierSwitcherOpen, setIsIdentifierSwitcherOpen] = React.useState(false);
    const [isPinnedMenuOpen, setIsPinnedMenuOpen] = React.useState(false);
    const [isExpedientesSubmenuOpen, setIsExpedientesSubmenuOpen] = React.useState(currentView === 'dashboard' || currentView === 'detail');
    const [hasSeenHelp, setHasSeenHelp] = React.useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem(HELP_SEEN_KEY) === 'true';
    });
    const [showHelpHint, setShowHelpHint] = React.useState(false);
    const [helpDataRangeByView, setHelpDataRangeByView] = React.useState<Record<string, { minDate?: string | null; maxDate?: string | null; sourceLabel?: string | null }>>({});
    const pinnedMenuRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        const refresh = () => {
            setActiveIdentifier(readActiveClientIdentifier());
            setIsPinned(readIsIdentifierPinned());
            setPinnedIdentifier(readPinnedIdentifier());
        };
        refresh();
        window.addEventListener('hashchange', refresh);
        window.addEventListener('focus', refresh);
        window.addEventListener(getIdentifierContextChangedEventName(), refresh as EventListener);
        return () => {
            window.removeEventListener('hashchange', refresh);
            window.removeEventListener('focus', refresh);
            window.removeEventListener(getIdentifierContextChangedEventName(), refresh as EventListener);
        };
    }, []);

    React.useEffect(() => {
        const onDataRange = (event: Event) => {
            const customEvent = event as CustomEvent<{ view?: string; minDate?: string | null; maxDate?: string | null; sourceLabel?: string | null }>;
            const detail = customEvent.detail;
            if (!detail?.view) return;
            setHelpDataRangeByView(prev => ({
                ...prev,
                [detail.view as string]: {
                    minDate: detail.minDate || null,
                    maxDate: detail.maxDate || null,
                    sourceLabel: detail.sourceLabel || null
                }
            }));
        };
        window.addEventListener('aga:help-data-range', onDataRange as EventListener);
        return () => window.removeEventListener('aga:help-data-range', onDataRange as EventListener);
    }, []);

    const helpContent = React.useMemo(
        () => resolveHelpForView(currentView, {
            activeIdentifier: isPinned ? (pinnedIdentifier || activeIdentifier) : activeIdentifier,
            dataRangeByView: helpDataRangeByView
        }),
        [currentView, activeIdentifier, isPinned, pinnedIdentifier, helpDataRangeByView]
    );
    const {
        hint,
        dismissHint,
        predictiveEnabled,
        setPredictiveEnabled,
        userSkillLevel
    } = usePredictiveHelp({ activeIdentifier });

    const openHelp = React.useCallback(() => {
        setIsHelpOpen(true);
        setShowHelpHint(false);
        if (!hasSeenHelp && typeof window !== 'undefined') {
            try {
                window.localStorage.setItem(HELP_SEEN_KEY, 'true');
            } catch {
                // ignore storage failures
            }
            setHasSeenHelp(true);
        }
    }, [hasSeenHelp]);

    // Ctrl+K / Cmd+K opens identifier switcher. F1 opens contextual help.
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setIsIdentifierSwitcherOpen(true);
            }
            if (e.key === 'F1') {
                e.preventDefault();
                openHelp();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [openHelp]);

    React.useEffect(() => {
        if (!isPinnedMenuOpen) return;
        const handleMouseDown = (event: MouseEvent) => {
            if (pinnedMenuRef.current && !pinnedMenuRef.current.contains(event.target as Node)) {
                setIsPinnedMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleMouseDown);
        return () => document.removeEventListener('mousedown', handleMouseDown);
    }, [isPinnedMenuOpen]);

    React.useEffect(() => {
        if (hasSeenHelp) {
            setShowHelpHint(false);
            return;
        }
        const timer = window.setTimeout(() => setShowHelpHint(true), 700);
        return () => window.clearTimeout(timer);
    }, [hasSeenHelp]);

    const handleNavClick = (item: typeof APP_NAV_ITEMS[number]) => {
        if (item.id === 'dashboard') {
            setIsExpedientesSubmenuOpen(v => !v);
            navigateToModule(item.path);
            return;
        }
        if (item.id === 'config') {
            setIsAdminModalOpen(true);
        } else {
            navigateToModule(item.path);
        }
    };

    React.useEffect(() => {
        if (currentView === 'dashboard' || currentView === 'detail') {
            setIsExpedientesSubmenuOpen(true);
        }
    }, [currentView]);

    const handleLogout = async () => {
        if (isLoggingOut) return;
        setIsLoggingOut(true);
        try {
            resetSessionContext({ hard: true });
            await signOut(auth);
            window.location.hash = '/';
            window.location.reload();
        } catch (error) {
            console.error('Error al cerrar sesión:', error);
            setIsLoggingOut(false);
        }
    };

    return (
        <div className="relative flex h-auto min-h-screen w-full flex-col bg-slate-50 group/design-root font-sans" style={{ fontFamily: 'Inter, "Noto Sans", sans-serif' }}>
            <div className="layout-container flex h-full grow flex-col">
                {/* Modern Header with Top Navigation */}
                <header className="flex items-center justify-between whitespace-nowrap border-b border-solid border-b-[#e7edf3] px-10 py-3 bg-white shrink-0 sticky top-0 z-50">
                    <div className="flex items-center gap-8 text-[#0d141b]">
                        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => navigateTo('/')}>
                            <img
                                src={appIcon}
                                alt="AGA Nexus"
                                className="size-8 object-cover rounded-full transition-transform group-hover:scale-110"
                            />
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center px-4 py-1.5 bg-white/80 backdrop-blur-md rounded-xl border border-white shadow-sm">
                                    <div className="flex items-baseline">
                                        <span className="text-slate-600 font-bold tracking-[0.12em] text-[11px] mr-2 uppercase leading-none">
                                            AGA
                                        </span>
                                        <span className="text-slate-500 font-semibold tracking-tight text-lg leading-none bg-gradient-to-r from-slate-600 to-slate-400 bg-clip-text text-transparent">
                                            Nexus
                                        </span>
                                    </div>

                                    <div className="mx-3 w-[1px] h-3 bg-slate-200" />

                                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-50 rounded-md border border-slate-100">
                                        <Cpu size={10} className="text-[#0071E3] opacity-70" />
                                        <span className="text-[9px] font-mono font-bold text-slate-400 tracking-tighter">
                                            3.3/09
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1.5 ml-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                                        System Ready
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-1 justify-end gap-4 items-center">
                        {isPinned && pinnedIdentifier && (
                            <div ref={pinnedMenuRef} className="relative">
                                <button
                                    type="button"
                                    onClick={() => setIsPinnedMenuOpen(v => !v)}
                                    title="Identificador fijado activo"
                                    className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                                >
                                    <Pin className="h-3.5 w-3.5" />
                                    <span className="font-mono">{pinnedIdentifier}</span>
                                </button>
                                {isPinnedMenuOpen && (
                                    <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white shadow-xl z-[120] overflow-hidden">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsPinnedMenuOpen(false);
                                                setIsIdentifierSwitcherOpen(true);
                                            }}
                                            className="w-full text-left px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                                        >
                                            Cambiar identificador
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                navigator.clipboard.writeText(pinnedIdentifier).catch(() => undefined);
                                                setIsPinnedMenuOpen(false);
                                            }}
                                            className="w-full text-left px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 border-t border-slate-100"
                                        >
                                            Copiar identificador
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                unpinClientIdentifier();
                                                setIsPinnedMenuOpen(false);
                                            }}
                                            className="w-full text-left px-3 py-2.5 text-sm text-rose-700 hover:bg-rose-50 border-t border-slate-100"
                                        >
                                            Desfijar
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="relative">
                            <button
                                onClick={openHelp}
                                title="Ayuda contextual (F1)"
                                aria-label="Ayuda contextual"
                                className="inline-flex h-10 items-center gap-2 rounded-full border border-sky-200 bg-sky-50/80 px-3 text-sky-700 shadow-sm transition-all hover:bg-sky-100 hover:border-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                            >
                                <HelpCircle size={16} />
                                <span className="hidden sm:inline text-xs font-semibold uppercase tracking-[0.14em]">Ayuda</span>
                                {!hasSeenHelp && (
                                    <span className="inline-flex h-2 w-2 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.45)]" aria-hidden="true" />
                                )}
                            </button>
                            {showHelpHint && !hasSeenHelp && (
                                <div className="pointer-events-auto absolute right-0 top-[calc(100%+8px)] z-[130] w-64 rounded-xl border border-sky-200 bg-white p-3 shadow-xl">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">Ayuda contextual</p>
                                    <p className="mt-1 text-xs text-slate-600">Tienes ayuda contextual aquí. Pulsa F1 cuando quieras.</p>
                                    <button
                                        type="button"
                                        onClick={() => setShowHelpHint(false)}
                                        className="mt-2 text-[11px] font-semibold text-sky-700 hover:text-sky-800"
                                    >
                                        Entendido
                                    </button>
                                </div>
                            )}
                        </div>

                        <ViewModeToggle />

                        {onOpenThemeSettings && (
                            <button
                                onClick={onOpenThemeSettings}
                                title="Ajustes Visuales"
                                className="p-2.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-xl transition-all border border-transparent hover:border-sky-100"
                            >
                                <Sparkles size={18} />
                            </button>
                        )}
                    </div>
                </header>

                {/* Main Content Area */}
                <div className="flex flex-1 min-h-0">
                    <aside className="w-[220px] shrink-0 border-r border-slate-200/80 bg-white/90 backdrop-blur-sm">
                        <nav className="flex h-full flex-col px-4 py-4">
                            <div className="space-y-1.5">
                                {APP_NAV_ITEMS.map((item) => {
                                    const Icon = item.icon;
                                    const isActive = currentView === item.id || (item.id === 'dashboard' && currentView === 'detail');
                                    return (
                                        <div key={item.id}>
                                            <button
                                                onClick={() => handleNavClick(item)}
                                                className={`group flex w-full items-center gap-2.5 rounded-2xl border px-2.5 py-2.5 text-left text-[10px] uppercase tracking-[0.16em] transition-all duration-200 ${isActive
                                                    ? 'border-sky-200 bg-sky-50 text-sky-700 shadow-sm'
                                                    : 'border-transparent bg-transparent text-slate-500 hover:border-sky-100 hover:bg-sky-50/70 hover:text-sky-700'
                                                    }`}
                                            >
                                                <Icon className={`h-4 w-4 ${isActive ? 'text-sky-600' : 'text-slate-400 group-hover:text-sky-600'}`} />
                                                <span className={`flex-1 ${isActive ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
                                                {item.id === 'dashboard' && (
                                                    isExpedientesSubmenuOpen
                                                        ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-sky-600" />
                                                        : <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-sky-600" />
                                                )}
                                            </button>

                                            {item.id === 'dashboard' && isExpedientesSubmenuOpen && (
                                                <div className="ml-6 mt-1 space-y-1 border-l border-slate-100 pl-2">
                                                    <button
                                                        onClick={onNewCaseSameClient}
                                                        disabled={!onNewCaseSameClient || !canCreateSameClient}
                                                        className="w-full rounded-xl px-2 py-2 text-left text-[9px] font-medium uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-slate-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
                                                        title={canCreateSameClient ? 'Crear nuevo expediente con el mismo cliente' : 'No hay cliente activo para esta opción'}
                                                    >
                                                        Nuevo (mismo cliente)
                                                    </button>
                                                    <button
                                                        onClick={onNewCaseDifferentClient}
                                                        disabled={!onNewCaseDifferentClient}
                                                        className="w-full rounded-xl px-2 py-2 text-left text-[9px] font-medium uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-slate-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
                                                        title="Crear nuevo expediente con otro cliente"
                                                    >
                                                        Nuevo (otro cliente)
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="mt-4 border-t border-slate-100 pt-4">
                                <button
                                    onClick={handleLogout}
                                    disabled={isLoggingOut}
                                    className="group flex w-full items-center gap-2.5 rounded-2xl border border-rose-100 bg-rose-50/70 px-2.5 py-2.5 text-left text-[10px] uppercase tracking-[0.16em] text-rose-700 transition-all duration-200 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <LogOut className="h-4 w-4 text-rose-500" />
                                    <span className="font-semibold">{isLoggingOut ? 'Cerrando...' : 'Cerrar sesión'}</span>
                                </button>
                            </div>
                        </nav>
                    </aside>

                    <main className="min-w-0 flex-1 overflow-auto">
                        {children}
                    </main>
                </div>

                <SecureConfirmationModal
                    isOpen={isAdminModalOpen}
                    onClose={() => setIsAdminModalOpen(false)}
                    onConfirm={() => {
                        setIsAdminModalOpen(false);
                        setViewMode('menu');
                        navigateTo('/config');
                    }}
                    title="Acceso Administrativo"
                    message="Introduce la contraseña de seguridad para acceder al panel de control global."
                    requirePassword={true}
                    correctPassword={appSettings?.deletePassword || '1812'}
                />

                <GlobalSearchModal
                    isOpen={isSearchModalOpen}
                    onClose={() => setIsSearchModalOpen(false)}
                />

                <IdentifierSwitcherModal
                    isOpen={isIdentifierSwitcherOpen}
                    mode={isPinned ? 'pinned' : 'active'}
                    onClose={() => setIsIdentifierSwitcherOpen(false)}
                />

                <ContextHelpDrawer
                    isOpen={isHelpOpen}
                    onClose={() => setIsHelpOpen(false)}
                    content={helpContent}
                    predictiveEnabled={predictiveEnabled}
                    onTogglePredictive={setPredictiveEnabled}
                    userSkillLevel={userSkillLevel}
                />

                {predictiveEnabled && hint && (
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={openHelp}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openHelp();
                            }
                        }}
                        className="fixed bottom-4 right-4 z-[120] max-w-[380px] rounded-2xl border border-sky-200 bg-white/95 px-4 py-3 text-left shadow-lg backdrop-blur-sm transition-all hover:shadow-xl"
                        title="Abrir ayuda contextual"
                    >
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(2,132,199,0.45)]" />
                            <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">Ayuda inteligente</p>
                                <p className="mt-1 text-sm text-slate-700">{hint.message}</p>
                            </div>
                            <button
                                type="button"
                                aria-label="Cerrar sugerencia"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    dismissHint();
                                }}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AppShell;
