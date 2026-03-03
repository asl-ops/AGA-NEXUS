import React from 'react';
import { FolderClock } from 'lucide-react';
import { ModuleInDevelopmentNotice } from '@/components/ui/ModuleInDevelopmentNotice';

const PreaperturaView: React.FC = () => {
    return (
        <div className="flex h-full min-h-0 flex-col bg-slate-50">
            <ModuleInDevelopmentNotice moduleName="Expedientes en preapertura" />

            <div className="flex flex-1 items-center justify-center p-8">
                <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
                    <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-sky-100 bg-sky-50 text-sky-700">
                        <FolderClock className="h-8 w-8" />
                    </div>
                    <h2 className="text-xl font-semibold text-slate-800">Módulo de Preapertura</h2>
                    <p className="mt-3 text-sm text-slate-500">
                        Aquí se prepararán expedientes modelo para apertura global o seleccionada con movimientos predefinidos.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PreaperturaView;

