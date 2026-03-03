import React from 'react';
import { Construction } from 'lucide-react';

type ModuleInDevelopmentNoticeProps = {
    moduleName: string;
    message?: string;
};

export const ModuleInDevelopmentNotice: React.FC<ModuleInDevelopmentNoticeProps> = ({ moduleName, message }) => {
    return (
        <div className="mx-8 mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3">
            <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-amber-800">
                <Construction className="h-3.5 w-3.5" />
                <span>{moduleName} en desarrollo</span>
            </div>
            <p className="mt-1 text-xs text-amber-700">
                {message || 'Este módulo está en evolución. Algunas funciones se seguirán completando en próximas iteraciones.'}
            </p>
        </div>
    );
};
