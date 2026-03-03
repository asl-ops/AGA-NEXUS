import { HELP_FALLBACK, HELP_REGISTRY, type AppHelpView, type HelpContent } from './helpRegistry';

type HelpContext = {
    activeIdentifier?: string | null;
    dataRangeByView?: Record<string, { minDate?: string | null; maxDate?: string | null; sourceLabel?: string | null }>;
};

export type ResolvedHelpContent = HelpContent & {
    dynamicTips: string[];
    rangeLabel?: string | null;
    rangeSourceLabel?: string | null;
    columnsGuidance?: string[];
};

export const resolveHelpForView = (
    view: AppHelpView,
    context: HelpContext = {}
): ResolvedHelpContent => {
    const base = HELP_REGISTRY[view] || HELP_FALLBACK;
    const dynamicTips: string[] = [];
    const rangeMeta = context.dataRangeByView?.[view];
    const rangeLabel = rangeMeta?.minDate && rangeMeta?.maxDate
        ? `${rangeMeta.minDate} → ${rangeMeta.maxDate}`
        : null;

    if (context.activeIdentifier) {
        dynamicTips.push(`Cliente activo en sesión: ${context.activeIdentifier}.`);
    } else {
        dynamicTips.push('No hay cliente activo en esta sesión.');
    }

    const explorerViews = new Set(['clients', 'dashboard', 'billing', 'proformas', 'invoices', 'economico', 'cash']);
    const columnsGuidance = explorerViews.has(String(view))
        ? [
            'Puedes redimensionar el ancho arrastrando el separador entre columnas.',
            'Activa "Ajustar columnas" para ver guías de redimensionado.',
            'Consejo: ensancha Cliente u Observaciones para leer más texto.'
        ]
        : undefined;

    return {
        ...base,
        dynamicTips,
        rangeLabel,
        rangeSourceLabel: rangeMeta?.sourceLabel || null,
        columnsGuidance
    };
};
