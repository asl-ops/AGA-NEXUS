export type PredictiveHintType =
    | 'idle'
    | 'error'
    | 'no_results'
    | 'incomplete_action'
    | 'multi_select'
    | 'power_tip';

export type PredictiveHint = {
    id: string;
    message: string;
    priority: 1 | 2 | 3 | 4;
    type: PredictiveHintType;
    autoDismissMs: number;
};

export type PredictiveState = {
    focusedField?: string | null;
    inputValue?: string;
    inactivityMs?: number;
    eraseAttempts?: number;
};

export type PredictiveHistory = {
    recentActions: string[];
    recentErrors: string[];
    successfulActions: number;
    totalActions: number;
    averageActionMs?: number;
};

export type PredictiveUiState = {
    activeIdentifier?: string | null;
    resultsCount?: number | null;
    selectedRows?: number;
    isEditing?: boolean;
};

const HINTS = {
    idle_enter_search: {
        id: 'idle_enter_search',
        message: 'Puedes pulsar Enter para ejecutar la búsqueda.',
        priority: 3 as const,
        type: 'idle' as const,
        autoDismissMs: 4200
    },
    erase_client_field: {
        id: 'erase_client_field',
        message: 'Parece que estás cambiando cliente. Usa Recientes para seleccionarlo más rápido.',
        priority: 2 as const,
        type: 'error' as const,
        autoDismissMs: 5200
    },
    no_results: {
        id: 'no_results',
        message: 'No hay coincidencias. Prueba con menos caracteres o limpia filtros.',
        priority: 2 as const,
        type: 'no_results' as const,
        autoDismissMs: 5200
    },
    missing_client_for_invoice: {
        id: 'missing_client_for_invoice',
        message: 'Antes de crear una factura debes seleccionar un cliente.',
        priority: 1 as const,
        type: 'incomplete_action' as const,
        autoDismissMs: 5600
    },
    multi_select: {
        id: 'multi_select',
        message: 'Tienes varios elementos seleccionados. Puedes aplicar acciones masivas.',
        priority: 3 as const,
        type: 'multi_select' as const,
        autoDismissMs: 4800
    },
    power_user_identifier: {
        id: 'power_user_identifier',
        message: 'Consejo avanzado: escribe el identificador y pulsa Enter para acelerar el flujo.',
        priority: 4 as const,
        type: 'power_tip' as const,
        autoDismissMs: 4600
    }
};

const contains = (arr: string[], value: string): boolean =>
    arr.some((entry) => entry === value);

export const evaluateUserIntent = (
    state: PredictiveState,
    history: PredictiveHistory,
    uiState: PredictiveUiState
): PredictiveHint | null => {
    // 1) Critical / blocked flow
    if (
        contains(history.recentErrors, 'INVOICE_CREATE_WITHOUT_CLIENT') &&
        !uiState.activeIdentifier
    ) {
        return HINTS.missing_client_for_invoice;
    }

    // 2) Frequent field erase pattern
    if ((state.eraseAttempts || 0) >= 3) {
        return HINTS.erase_client_field;
    }

    // 3) Empty results pattern
    if (
        contains(history.recentErrors, 'EMPTY_RESULT') ||
        (typeof uiState.resultsCount === 'number' && uiState.resultsCount === 0 && (state.inputValue || '').trim().length > 1)
    ) {
        return HINTS.no_results;
    }

    // 4) Multi-select optimization tip
    if ((uiState.selectedRows || 0) > 1) {
        return HINTS.multi_select;
    }

    // 5) Idle + focus on searchable fields
    if (
        (state.inactivityMs || 0) >= 6000 &&
        (state.focusedField || '').includes('search')
    ) {
        return HINTS.idle_enter_search;
    }

    // 6) Power tip for advanced users
    const actions = Math.max(history.totalActions, 1);
    const successRatio = history.successfulActions / actions;
    if (
        successRatio >= 0.75 &&
        actions >= 10 &&
        (history.averageActionMs || 999999) < 6000
    ) {
        return HINTS.power_user_identifier;
    }

    return null;
};

export const calculateUserSkillLevel = (history: PredictiveHistory): 0 | 1 | 2 | 3 | 4 => {
    const total = Math.max(history.totalActions, 1);
    const ratio = history.successfulActions / total;
    const avg = history.averageActionMs || 12000;
    if (total < 5) return 0;
    if (ratio < 0.45 || avg > 15000) return 1;
    if (ratio < 0.7 || avg > 9000) return 2;
    if (ratio < 0.88 || avg > 4500) return 3;
    return 4;
};
