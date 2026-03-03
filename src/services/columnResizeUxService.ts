export const COLUMN_RESIZE_UX_STORAGE_KEY = 'aga-column-resize-guides-enabled-v1';
export const COLUMN_RESIZE_UX_CHANGED_EVENT = 'aga:column-resize-ux-changed';

export function readColumnResizeGuidesEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COLUMN_RESIZE_UX_STORAGE_KEY) === 'true';
}

export function setColumnResizeGuidesEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLUMN_RESIZE_UX_STORAGE_KEY, String(enabled));
    window.dispatchEvent(new CustomEvent(COLUMN_RESIZE_UX_CHANGED_EVENT, { detail: { enabled } }));
}
