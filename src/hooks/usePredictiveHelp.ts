import React from 'react';
import {
    calculateUserSkillLevel,
    evaluateUserIntent,
    type PredictiveHint,
    type PredictiveHistory,
    type PredictiveUiState
} from '@/help/predictiveEngine';

type RegisterPayload = {
    durationMs?: number;
};

type UsePredictiveHelpParams = {
    activeIdentifier?: string | null;
    resultsCount?: number | null;
    selectedRows?: number;
    isEditing?: boolean;
};

const SEEN_HINTS_KEY = 'aga.predictiveHelp.seen';
const SKILL_LEVEL_KEY = 'aga.predictiveHelp.userSkillLevel';
const ENABLED_KEY = 'aga.predictiveHelp.enabled';
const MIN_HINT_INTERVAL_MS = 8000;

const getSeenHints = (): Set<string> => {
    try {
        const raw = sessionStorage.getItem(SEEN_HINTS_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw) as string[];
        return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
        return new Set();
    }
};

const saveSeenHints = (seen: Set<string>) => {
    try {
        sessionStorage.setItem(SEEN_HINTS_KEY, JSON.stringify(Array.from(seen)));
    } catch {
        // no-op
    }
};

const readEnabled = (): boolean => {
    try {
        const raw = sessionStorage.getItem(ENABLED_KEY);
        if (!raw) return true;
        return raw === 'true';
    } catch {
        return true;
    }
};

const saveEnabled = (enabled: boolean) => {
    try {
        sessionStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
    } catch {
        // no-op
    }
};

export const usePredictiveHelp = ({
    activeIdentifier,
    resultsCount,
    selectedRows,
    isEditing
}: UsePredictiveHelpParams) => {
    const [hint, setHint] = React.useState<PredictiveHint | null>(null);
    const [enabled, setEnabled] = React.useState<boolean>(() => readEnabled());
    const [focusedField, setFocusedField] = React.useState<string | null>(null);
    const [inputValue, setInputValue] = React.useState<string>('');
    const [eraseAttempts, setEraseAttempts] = React.useState(0);
    const [inactivityMs, setInactivityMs] = React.useState(0);
    const [userSkillLevel, setUserSkillLevel] = React.useState<number>(() => {
        try {
            return Number(sessionStorage.getItem(SKILL_LEVEL_KEY) || 0);
        } catch {
            return 0;
        }
    });

    const seenHintsRef = React.useRef<Set<string>>(getSeenHints());
    const lastHintShownAtRef = React.useRef<number>(0);
    const historyRef = React.useRef<PredictiveHistory>({
        recentActions: [],
        recentErrors: [],
        successfulActions: 0,
        totalActions: 0,
        averageActionMs: undefined
    });
    const hintTimerRef = React.useRef<number | null>(null);
    const inactivityTickRef = React.useRef<number | null>(null);
    const inactivityStartedAtRef = React.useRef<number>(Date.now());

    const uiState = React.useMemo<PredictiveUiState>(() => ({
        activeIdentifier,
        resultsCount,
        selectedRows,
        isEditing
    }), [activeIdentifier, resultsCount, selectedRows, isEditing]);

    const dismissHint = React.useCallback(() => {
        if (hintTimerRef.current) {
            window.clearTimeout(hintTimerRef.current);
            hintTimerRef.current = null;
        }
        setHint(null);
    }, []);

    const pushToHistory = (arr: string[], value: string): string[] => [value, ...arr].slice(0, 12);

    const registerAction = React.useCallback((action: string, payload: RegisterPayload = {}) => {
        const previous = historyRef.current;
        const totalActions = previous.totalActions + 1;
        const successfulActions = previous.successfulActions + 1;
        const currentAvg = previous.averageActionMs;
        const durationMs = payload.durationMs;
        const averageActionMs = typeof durationMs === 'number'
            ? (typeof currentAvg === 'number'
                ? ((currentAvg * (totalActions - 1)) + durationMs) / totalActions
                : durationMs)
            : currentAvg;

        const next: PredictiveHistory = {
            ...previous,
            recentActions: pushToHistory(previous.recentActions, action),
            totalActions,
            successfulActions,
            averageActionMs
        };
        historyRef.current = next;

        const level = calculateUserSkillLevel(next);
        setUserSkillLevel(level);
        try {
            sessionStorage.setItem(SKILL_LEVEL_KEY, String(level));
        } catch {
            // no-op
        }
    }, []);

    const registerError = React.useCallback((errorCode: string) => {
        const previous = historyRef.current;
        historyRef.current = {
            ...previous,
            recentErrors: pushToHistory(previous.recentErrors, errorCode),
            totalActions: previous.totalActions + 1
        };
    }, []);

    const evaluateAndDisplay = React.useCallback(() => {
        if (!enabled) return;
        const now = Date.now();
        if (now - lastHintShownAtRef.current < MIN_HINT_INTERVAL_MS) return;

        const candidate = evaluateUserIntent(
            {
                focusedField,
                inputValue,
                inactivityMs,
                eraseAttempts
            },
            historyRef.current,
            uiState
        );
        if (!candidate) return;
        if (seenHintsRef.current.has(candidate.id)) return;

        seenHintsRef.current.add(candidate.id);
        saveSeenHints(seenHintsRef.current);
        lastHintShownAtRef.current = now;
        setHint(candidate);

        if (hintTimerRef.current) {
            window.clearTimeout(hintTimerRef.current);
        }
        hintTimerRef.current = window.setTimeout(() => {
            setHint(null);
            hintTimerRef.current = null;
        }, candidate.autoDismissMs);
    }, [enabled, eraseAttempts, focusedField, inactivityMs, inputValue, uiState]);

    React.useEffect(() => {
        const handleFocusIn = (event: FocusEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target) return;
            if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
            const hintKey = target.dataset.helpField
                || target.getAttribute('name')
                || target.getAttribute('placeholder')
                || target.id
                || 'input';
            setFocusedField(String(hintKey).toLowerCase());
            setInputValue(target.value || '');
            inactivityStartedAtRef.current = Date.now();
            setInactivityMs(0);
        };

        const handleInput = (event: Event) => {
            const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
            if (!target) return;
            setInputValue(target.value || '');
            inactivityStartedAtRef.current = Date.now();
            setInactivityMs(0);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLInputElement | HTMLTextAreaElement | null;
            if (!target) return;
            if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

            if (event.key === 'Enter') {
                registerAction('SEARCH_EXECUTED');
            }
            if (event.key === 'Backspace' && (target.value || '').length === 0) {
                setEraseAttempts((prev) => prev + 1);
            }
            inactivityStartedAtRef.current = Date.now();
            setInactivityMs(0);
        };

        const onActionEvent = (event: Event) => {
            const custom = event as CustomEvent<{ action: string; durationMs?: number }>;
            const action = custom.detail?.action;
            if (!action) return;
            registerAction(action, { durationMs: custom.detail?.durationMs });
        };

        const onErrorEvent = (event: Event) => {
            const custom = event as CustomEvent<{ error: string }>;
            const error = custom.detail?.error;
            if (!error) return;
            registerError(error);
        };

        document.addEventListener('focusin', handleFocusIn);
        document.addEventListener('input', handleInput);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('aga:help-action', onActionEvent as EventListener);
        window.addEventListener('aga:help-error', onErrorEvent as EventListener);

        inactivityTickRef.current = window.setInterval(() => {
            setInactivityMs(Date.now() - inactivityStartedAtRef.current);
        }, 1000);

        return () => {
            document.removeEventListener('focusin', handleFocusIn);
            document.removeEventListener('input', handleInput);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('aga:help-action', onActionEvent as EventListener);
            window.removeEventListener('aga:help-error', onErrorEvent as EventListener);
            if (inactivityTickRef.current) window.clearInterval(inactivityTickRef.current);
            if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
        };
    }, [registerAction, registerError]);

    React.useEffect(() => {
        evaluateAndDisplay();
    }, [evaluateAndDisplay]);

    const setPredictiveEnabled = React.useCallback((next: boolean) => {
        setEnabled(next);
        saveEnabled(next);
        if (!next) dismissHint();
    }, [dismissHint]);

    return {
        hint,
        dismissHint,
        registerAction,
        registerError,
        predictiveEnabled: enabled,
        setPredictiveEnabled,
        userSkillLevel
    };
};

