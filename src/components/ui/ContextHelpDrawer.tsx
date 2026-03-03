import React from 'react';
import { X, Keyboard } from 'lucide-react';
import type { ResolvedHelpContent } from '@/help/helpResolver';

type ContextHelpDrawerProps = {
    isOpen: boolean;
    onClose: () => void;
    content: ResolvedHelpContent;
    predictiveEnabled?: boolean;
    onTogglePredictive?: (enabled: boolean) => void;
    userSkillLevel?: number;
};

export const ContextHelpDrawer: React.FC<ContextHelpDrawerProps> = ({
    isOpen,
    onClose,
    content,
    predictiveEnabled = true,
    onTogglePredictive,
    userSkillLevel = 0
}) => {
    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 z-[140] bg-slate-900/30" onClick={onClose} />
            <aside className="fixed right-0 top-0 z-[150] h-full w-full max-w-[460px] border-l border-slate-200 bg-white shadow-2xl">
                <div className="flex h-full flex-col">
                    <header className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
                        <div>
                            <h2 className="text-base font-semibold uppercase tracking-wider text-slate-800">{content.title}</h2>
                            <p className="mt-2 text-sm text-slate-500">{content.summary}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                            aria-label="Cerrar ayuda"
                            title="Cerrar ayuda"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </header>

                    <div className="flex-1 overflow-auto px-6 py-5 space-y-6">
                        {content.whatIs && content.whatIs.length > 0 && (
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Qué es esta pantalla</h3>
                                <ul className="mt-3 space-y-2">
                                    {content.whatIs.map((item) => (
                                        <li key={item} className="text-sm text-slate-600">
                                            • {item}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        <section>
                            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Qué puedes hacer aquí</h3>
                            <ul className="mt-3 space-y-2">
                                {(content.whatCanDo || content.usage).map((item) => (
                                    <li key={item} className="text-sm text-slate-600">
                                        • {item}
                                    </li>
                                ))}
                            </ul>
                        </section>

                        {content.whatSeeing && content.whatSeeing.length > 0 && (
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Qué estás viendo realmente</h3>
                                <ul className="mt-3 space-y-2">
                                    {content.whatSeeing.map((item) => (
                                        <li key={item} className="text-sm text-slate-600">
                                            • {item}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {content.whySlow && content.whySlow.length > 0 && (
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Por qué puede tardar</h3>
                                <ul className="mt-3 space-y-2">
                                    {content.whySlow.map((item) => (
                                        <li key={item} className="text-sm text-slate-600">
                                            • {item}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        {content.rangeLabel && (
                            <section className="rounded-2xl border border-sky-100 bg-sky-50/60 px-4 py-3">
                                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">Rango de datos disponible</h3>
                                <p className="mt-2 text-sm text-slate-700">
                                    Datos disponibles: <span className="font-semibold">{content.rangeLabel}</span>
                                </p>
                                {content.rangeSourceLabel && (
                                    <p className="mt-1 text-xs text-slate-500">Origen: {content.rangeSourceLabel}</p>
                                )}
                            </section>
                        )}

                        {content.columnsGuidance && content.columnsGuidance.length > 0 && (
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Columnas</h3>
                                <ul className="mt-3 space-y-2">
                                    {content.columnsGuidance.map((item) => (
                                        <li key={item} className="text-sm text-slate-600">
                                            • {item}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}

                        <section>
                            <div className="flex items-center gap-2">
                                <Keyboard className="h-4 w-4 text-sky-600" />
                                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Teclas y atajos</h3>
                            </div>
                            <div className="mt-3 space-y-2">
                                {content.keys.map((item) => (
                                    <div key={`${item.key}-${item.action}`} className="flex items-start justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                                        <span className="inline-flex rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                            {item.key}
                                        </span>
                                        <span className="text-xs text-slate-600 text-right">{item.action}</span>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section>
                            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Cómo trabajar más rápido</h3>
                            <ul className="mt-3 space-y-2">
                                {[...(content.howFaster || []), ...(content.tips || []), ...content.dynamicTips].map((item) => (
                                    <li key={item} className="text-sm text-slate-600">
                                        • {item}
                                    </li>
                                ))}
                            </ul>
                        </section>

                        {content.recommendedFlow && content.recommendedFlow.length > 0 && (
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Flujo recomendado de uso</h3>
                                <ol className="mt-3 space-y-2">
                                    {content.recommendedFlow.map((item, idx) => (
                                        <li key={item} className="text-sm text-slate-600">
                                            {idx + 1}. {item}
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        )}

                        <section className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">Ayuda predictiva</h3>
                            <p className="mt-2 text-xs text-slate-500">
                                Detecta contexto de uso para mostrar tips rápidos sin bloquear el trabajo.
                            </p>
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={() => onTogglePredictive?.(!predictiveEnabled)}
                                    className={`inline-flex items-center rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${predictiveEnabled
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                                        }`}
                                >
                                    {predictiveEnabled ? 'Activa' : 'Desactivada'}
                                </button>
                                <span className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                                    Nivel usuario: {userSkillLevel}
                                </span>
                            </div>
                        </section>
                    </div>
                </div>
            </aside>
        </>
    );
};
