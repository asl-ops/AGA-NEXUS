import { setViewMode } from '@/services/viewModeService';
import { buildPathWithClientNavigation, readClientNavigationContext } from './clientNavigationContext';

export interface ModuleNavItem {
    id: 'clients' | 'dashboard' | 'billing' | 'proformas' | 'invoices' | 'cash' | 'preapertura';
    label: string;
    path: string;
}

export const MODULE_NAV_ITEMS: ModuleNavItem[] = [
    { id: 'clients', label: 'Clientes', path: '/clients' },
    { id: 'dashboard', label: 'Expedientes', path: '/' },
    { id: 'preapertura', label: 'Expedientes en preapertura', path: '/preapertura' },
    { id: 'billing', label: 'Albaranes', path: '/billing' },
    { id: 'proformas', label: 'Proformas', path: '/proformas' },
    { id: 'invoices', label: 'Facturas', path: '/invoices' },
    { id: 'cash', label: 'Caja', path: '/cash' }
];

export const navigateToModule = (path: string) => {
    setViewMode('menu');
    const basePath = path.split('?')[0] || '';
    const shouldPreserveClientNavigation = ['/', '/billing', '/proformas', '/invoices', '/economico', '/cash', '/preapertura'].includes(basePath);
    const hasClientNavContext = readClientNavigationContext()?.active === true;
    const nextPath = shouldPreserveClientNavigation && hasClientNavContext
        ? buildPathWithClientNavigation(path)
        : path;
    window.location.hash = nextPath;
};
