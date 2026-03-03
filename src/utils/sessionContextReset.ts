const CONTEXT_LOCALSTORAGE_KEYS = [
    'invoices-filters-open',
    'proformas-filters-open',
    'economic-filters-open',
    'explorer.resizeHintSeen',
];

const CONTEXT_LOCALSTORAGE_PREFIXES = [
    'clientLists_',
];

const CONTEXT_LOCALSTORAGE_REGEX = [
    /^.*:sort$/,
];

export const resetSessionContext = ({ hard = false }: { hard?: boolean } = {}): void => {
    if (typeof window === 'undefined') return;

    try {
        window.sessionStorage.clear();
    } catch {
        // ignore storage failures
    }

    if (!hard) {
        window.dispatchEvent(new CustomEvent('aga:identifier-context-changed'));
        return;
    }

    try {
        for (const key of CONTEXT_LOCALSTORAGE_KEYS) {
            window.localStorage.removeItem(key);
        }

        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (!key) continue;
            if (CONTEXT_LOCALSTORAGE_PREFIXES.some(prefix => key.startsWith(prefix))) {
                keysToRemove.push(key);
                continue;
            }
            if (CONTEXT_LOCALSTORAGE_REGEX.some(re => re.test(key))) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => window.localStorage.removeItem(key));
    } catch {
        // ignore storage failures
    }

    window.dispatchEvent(new CustomEvent('aga:identifier-context-changed'));
};

