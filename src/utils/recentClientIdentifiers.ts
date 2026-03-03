export interface RecentClientIdentifierEntry {
    identifier: string;
    displayName: string;
}

const BASE_KEY = 'recent-client-identifiers-v1';
const ACTIVE_IDENTIFIER_KEY = 'aga-active-identifier-v1';
const PINNED_ENABLED_KEY = 'aga-identifier-pinned-v1';
const PINNED_IDENTIFIER_KEY = 'aga-pinned-identifier-v1';
const IDENTIFIER_CONTEXT_EVENT = 'aga:identifier-context-changed';
const DEFAULT_MAX_ITEMS = 8;

const normalizeIdentifier = (value?: string | null): string =>
    (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();

const getSessionKey = (): string => BASE_KEY;
const getLegacySessionKeys = (userId?: string | null): string[] => {
    const keys = [`${BASE_KEY}:anon`];
    if (userId) keys.unshift(`${BASE_KEY}:${userId}`);
    return keys;
};

const normalizeEntry = (entry: unknown): RecentClientIdentifierEntry | null => {
    if (typeof entry === 'string') {
        const identifier = normalizeIdentifier(entry);
        if (!identifier) return null;
        return { identifier, displayName: '' };
    }

    if (!entry || typeof entry !== 'object') return null;

    const maybe = entry as Partial<RecentClientIdentifierEntry>;
    const identifier = normalizeIdentifier(maybe.identifier);
    if (!identifier) return null;

    return {
        identifier,
        displayName: (maybe.displayName || '').trim(),
    };
};

export const readRecentClientIdentifiers = (
    userId?: string | null,
    maxItems: number = DEFAULT_MAX_ITEMS,
): RecentClientIdentifierEntry[] => {
    if (typeof window === 'undefined') return [];

    try {
        const currentRaw = window.sessionStorage.getItem(getSessionKey());
        const sourceEntries: unknown[] = [];

        if (currentRaw) {
            const parsed = JSON.parse(currentRaw);
            if (Array.isArray(parsed)) sourceEntries.push(...parsed);
        } else {
            // Compatibilidad: migrar claves antiguas por usuario/modulo a un historial global de sesion.
            for (const legacyKey of getLegacySessionKeys(userId)) {
                const legacyRaw = window.sessionStorage.getItem(legacyKey);
                if (!legacyRaw) continue;
                const legacyParsed = JSON.parse(legacyRaw);
                if (Array.isArray(legacyParsed)) sourceEntries.push(...legacyParsed);
            }
        }

        const unique = sourceEntries
            .map(normalizeEntry)
            .filter((entry): entry is RecentClientIdentifierEntry => !!entry)
            .filter((entry, index, arr) => arr.findIndex(x => x.identifier === entry.identifier) === index)
            .slice(0, Math.max(1, maxItems));

        if (unique.length > 0) {
            window.sessionStorage.setItem(getSessionKey(), JSON.stringify(unique));
        }

        return unique;
    } catch {
        return [];
    }
};

export const writeRecentClientIdentifiers = (
    _userId: string | null | undefined,
    items: RecentClientIdentifierEntry[],
    maxItems: number = DEFAULT_MAX_ITEMS,
): RecentClientIdentifierEntry[] => {
    const normalized = items
        .map(normalizeEntry)
        .filter((entry): entry is RecentClientIdentifierEntry => !!entry)
        .slice(0, Math.max(1, maxItems));

    if (typeof window === 'undefined') return normalized;

    try {
        window.sessionStorage.setItem(getSessionKey(), JSON.stringify(normalized));
    } catch {
        // ignore storage failures
    }

    return normalized;
};

export const pushRecentClientIdentifier = (
    userId: string | null | undefined,
    identifier?: string | null,
    displayName: string = '',
    maxItems: number = DEFAULT_MAX_ITEMS,
): RecentClientIdentifierEntry[] => {
    const normalizedIdentifier = normalizeIdentifier(identifier);
    if (!normalizedIdentifier) return readRecentClientIdentifiers(userId, maxItems);

    const current = readRecentClientIdentifiers(userId, maxItems);
    const existing = current.find(item => item.identifier === normalizedIdentifier);

    const nextEntry: RecentClientIdentifierEntry = {
        identifier: normalizedIdentifier,
        displayName: displayName.trim() || existing?.displayName || '',
    };

    const next = [nextEntry, ...current.filter(item => item.identifier !== normalizedIdentifier)]
        .slice(0, Math.max(1, maxItems));

    return writeRecentClientIdentifiers(userId, next, maxItems);
};

export const readActiveClientIdentifier = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        const value = window.sessionStorage.getItem(ACTIVE_IDENTIFIER_KEY);
        const normalized = normalizeIdentifier(value);
        return normalized || null;
    } catch {
        return null;
    }
};

export const setActiveClientIdentifier = (
    userId: string | null | undefined,
    identifier?: string | null,
    displayName: string = '',
): string | null => {
    const normalized = normalizeIdentifier(identifier);
    if (!normalized) {
        clearActiveClientIdentifier();
        return null;
    }
    if (typeof window !== 'undefined') {
        try {
            window.sessionStorage.setItem(ACTIVE_IDENTIFIER_KEY, normalized);
        } catch {
            // ignore storage failures
        }
    }
    pushRecentClientIdentifier(userId, normalized, displayName);
    emitIdentifierContextChanged();
    return normalized;
};

export const clearActiveClientIdentifier = (): void => {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.removeItem(ACTIVE_IDENTIFIER_KEY);
    } catch {
        // ignore storage failures
    }
    emitIdentifierContextChanged();
};

export const clearIdentifierContext = (): void => {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.removeItem(getSessionKey());
        for (const legacyKey of getLegacySessionKeys()) {
            window.sessionStorage.removeItem(legacyKey);
        }
        window.sessionStorage.removeItem(ACTIVE_IDENTIFIER_KEY);
        window.sessionStorage.removeItem(PINNED_ENABLED_KEY);
        window.sessionStorage.removeItem(PINNED_IDENTIFIER_KEY);
    } catch {
        // ignore storage failures
    }
    emitIdentifierContextChanged();
};

export const normalizeRecentClientIdentifier = normalizeIdentifier;

const emitIdentifierContextChanged = (): void => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(IDENTIFIER_CONTEXT_EVENT));
};

export const getIdentifierContextChangedEventName = (): string => IDENTIFIER_CONTEXT_EVENT;

export const readPinnedIdentifier = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        const value = window.sessionStorage.getItem(PINNED_IDENTIFIER_KEY);
        const normalized = normalizeIdentifier(value);
        return normalized || null;
    } catch {
        return null;
    }
};

export const readIsIdentifierPinned = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return window.sessionStorage.getItem(PINNED_ENABLED_KEY) === 'true';
    } catch {
        return false;
    }
};

export const readEffectiveClientIdentifier = (): string | null => {
    const isPinned = readIsIdentifierPinned();
    if (isPinned) {
        return readPinnedIdentifier();
    }
    return readActiveClientIdentifier();
};

export const setPinnedClientIdentifier = (
    userId: string | null | undefined,
    identifier?: string | null,
    displayName: string = '',
): string | null => {
    const normalized = normalizeIdentifier(identifier);
    if (!normalized) return null;
    if (typeof window !== 'undefined') {
        try {
            window.sessionStorage.setItem(PINNED_ENABLED_KEY, 'true');
            window.sessionStorage.setItem(PINNED_IDENTIFIER_KEY, normalized);
            window.sessionStorage.setItem(ACTIVE_IDENTIFIER_KEY, normalized);
        } catch {
            // ignore storage failures
        }
    }
    pushRecentClientIdentifier(userId, normalized, displayName);
    emitIdentifierContextChanged();
    return normalized;
};

export const unpinClientIdentifier = (): void => {
    if (typeof window === 'undefined') return;
    try {
        window.sessionStorage.removeItem(PINNED_ENABLED_KEY);
        window.sessionStorage.removeItem(PINNED_IDENTIFIER_KEY);
    } catch {
        // ignore storage failures
    }
    emitIdentifierContextChanged();
};

export const togglePinClientIdentifier = (
    userId: string | null | undefined,
): { isPinned: boolean; identifier: string | null } => {
    const isPinned = readIsIdentifierPinned();
    if (isPinned) {
        unpinClientIdentifier();
        return { isPinned: false, identifier: readActiveClientIdentifier() };
    }
    const base = readActiveClientIdentifier();
    if (!base) {
        return { isPinned: false, identifier: null };
    }
    const pinned = setPinnedClientIdentifier(userId, base);
    return { isPinned: !!pinned, identifier: pinned };
};
