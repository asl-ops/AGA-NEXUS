import React from 'react';
import { MoveHorizontal } from 'lucide-react';
import {
    COLUMN_RESIZE_UX_CHANGED_EVENT,
    readColumnResizeGuidesEnabled,
    setColumnResizeGuidesEnabled
} from '@/services/columnResizeUxService';

const RESIZE_HINT_SEEN_KEY = 'explorer.resizeHintSeen';

export const ColumnResizeToggle: React.FC = () => {
    const [enabled, setEnabled] = React.useState<boolean>(() => readColumnResizeGuidesEnabled());
    const [showHint, setShowHint] = React.useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem(RESIZE_HINT_SEEN_KEY) !== 'true';
    });

    React.useEffect(() => {
        const onChanged = (event: Event) => {
            const customEvent = event as CustomEvent<{ enabled?: boolean }>;
            if (typeof customEvent.detail?.enabled === 'boolean') {
                setEnabled(customEvent.detail.enabled);
                return;
            }
            setEnabled(readColumnResizeGuidesEnabled());
        };
        window.addEventListener(COLUMN_RESIZE_UX_CHANGED_EVENT, onChanged as EventListener);
        return () => window.removeEventListener(COLUMN_RESIZE_UX_CHANGED_EVENT, onChanged as EventListener);
    }, []);

    React.useEffect(() => {
        if (!showHint) return;
        const timer = window.setTimeout(() => setShowHint(false), 4000);
        return () => window.clearTimeout(timer);
    }, [showHint]);

    const handleToggle = () => {
        const next = !enabled;
        setEnabled(next);
        setColumnResizeGuidesEnabled(next);
        if (typeof window !== 'undefined' && window.localStorage.getItem(RESIZE_HINT_SEEN_KEY) !== 'true') {
            window.localStorage.setItem(RESIZE_HINT_SEEN_KEY, 'true');
        }
        setShowHint(false);
    };

    return (
        <div className="relative">
            <button
                type="button"
                onClick={handleToggle}
                className={`h-11 w-11 inline-flex items-center justify-center rounded-2xl border shadow-sm transition-all duration-200 active:scale-95 ${enabled
                    ? 'bg-[#EBF5FF] border-[#B2D7FF] text-[#0071E3]'
                    : 'bg-[#FAFAFA] border-slate-200 text-slate-600 hover:bg-[#EBF5FF] hover:border-[#B2D7FF] hover:text-[#0071E3]'
                    }`}
                title={enabled
                    ? 'Arrastra los separadores entre columnas para ajustar'
                    : 'Mostrar guias para ajustar el ancho de las columnas'}
                aria-label="Ajustar columnas"
            >
                <MoveHorizontal className="w-4 h-4" />
            </button>

            {showHint && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-40 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-[10px] font-semibold tracking-wide text-sky-700 whitespace-nowrap shadow-sm">
                    Tip: puedes ajustar columnas arrastrando separadores
                </div>
            )}
        </div>
    );
};
