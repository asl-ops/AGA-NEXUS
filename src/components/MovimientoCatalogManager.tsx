import React, { useState, useEffect, useRef } from 'react';
import {
    Movimiento,
    MovimientoCuentaContable,
    Naturaleza,
    RegimenIVA,
    RolCuenta,
    SubcategoriaSuplido,
    SUBCATEGORIAS_SUPLIDOS_FISCAL
} from '@/types';
import {
    getMovimientos,
    createMovimiento,
    updateMovimiento,
    softDeleteMovimiento,
    getCuentasContables,
    migrateGlobalMovementsToPrefix,
    recoverPrefixCatalogFromPredefinedRefs
} from '@/services/movimientoService';
import { getPrefixes } from '@/services/prefixService';
import { PrefixConfig } from '@/types';
import { useToast } from '@/hooks/useToast';
import {
    Plus,
    Trash2,
    Save,
    X,
    Search,
    AlertTriangle,
    Eye,
    Calculator,
    ShieldCheck,
    History,
    ArrowRight,
    Upload,
    CheckCircle2,
    Euro
} from 'lucide-react';
import { Button } from './ui/Button';
import { importEconomicModelFromExcel, ImportReport } from '@/services/importExcelService';
import { PremiumNumericInput } from './ui/PremiumNumericInput';
import { useConfirmation } from '@/hooks/useConfirmation';
import ConfirmationModal from './ConfirmationModal';

interface MovimientoCatalogManagerProps {
    initialPrefixId?: string;
    hidePrefixSelector?: boolean;
    embedded?: boolean;
}

const MovimientoCatalogManager: React.FC<MovimientoCatalogManagerProps> = ({
    initialPrefixId,
    hidePrefixSelector = false,
    embedded = false
}) => {
    const { addToast } = useToast();
    const { confirmationState, confirm, closeConfirmation } = useConfirmation();
    const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
    const [_loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [activeTab, setActiveTab] = useState<'general' | 'accounting'>('general');
    const [importReport, setImportReport] = useState<ImportReport | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isReportOpen, setIsReportOpen] = useState(false);
    const [autoRecoveredPrefixes, setAutoRecoveredPrefixes] = useState<Set<string>>(new Set());

    // Prefix state
    const [prefixes, setPrefixes] = useState<PrefixConfig[]>([]);
    const [selectedPrefixId, setSelectedPrefixId] = useState<string>('');

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [filterNaturaleza, setFilterNaturaleza] = useState<string>('ALL');
    const [showInactive, setShowInactive] = useState(false);

    // Form state
    const [formId, setFormId] = useState('');
    const [formCodigo, setFormCodigo] = useState('');
    const [formNombre, setFormNombre] = useState('');
    const [formNaturaleza, setFormNaturaleza] = useState<Naturaleza>(Naturaleza.HONORARIO);
    const [formRegimenIva, setFormRegimenIva] = useState<RegimenIVA>(RegimenIVA.SUJETO);
    const [formIvaDefecto, setFormIvaDefecto] = useState<number>(21);
    const [formAfectaIva, setFormAfectaIva] = useState(true);
    const [formSubcategoriaSuplido, setFormSubcategoriaSuplido] = useState<SubcategoriaSuplido | ''>('');
    const [showSubcategoriaError, setShowSubcategoriaError] = useState(false);
    const [formPermitirExcepcionIva, setFormPermitirExcepcionIva] = useState(false);
    const [formMotivoExencion, setFormMotivoExencion] = useState('');
    const [formIsActive, setFormIsActive] = useState(true);
    const [formImportePorDefecto, setFormImportePorDefecto] = useState<number>(0);
    const [formCuentas, setFormCuentas] = useState<Partial<MovimientoCuentaContable>[]>([]);
    const suplidoSubcategoriaRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        loadPrefixes();
    }, []);

    useEffect(() => {
        if (selectedPrefixId) {
            loadData();
        } else {
            setMovimientos([]);
        }
    }, [selectedPrefixId]);

    const loadPrefixes = async () => {
        try {
            const data = await getPrefixes();
            setPrefixes(data);
            if (data.length > 0) {
                if (initialPrefixId) {
                    setSelectedPrefixId(initialPrefixId);
                } else if (!selectedPrefixId) {
                    // Prioritize "FITRI" if exists, otherwise first one
                    const fitri = data.find(p => p.code.toUpperCase() === 'FITRI');
                    setSelectedPrefixId(fitri ? fitri.id : data[0].id);
                }
            }
        } catch (error) {
            addToast('Error al cargar prefijos', 'error');
        }
    };

    const loadData = async () => {
        if (!selectedPrefixId) return;
        setLoading(true);
        try {
            let data = await getMovimientos(selectedPrefixId);

            if (data.length === 0 && !autoRecoveredPrefixes.has(selectedPrefixId)) {
                const recoveredByRefs = await recoverPrefixCatalogFromPredefinedRefs(selectedPrefixId);
                if (recoveredByRefs.recovered > 0) {
                    addToast(
                        `Se restauraron ${recoveredByRefs.recovered} movimientos del catálogo desde las referencias del prefijo.`,
                        'success'
                    );
                    data = await getMovimientos(selectedPrefixId);
                } else {
                    const migrated = await migrateGlobalMovementsToPrefix(selectedPrefixId);
                    if (migrated.migrated > 0) {
                        addToast(
                            `Se migraron ${migrated.migrated} movimientos legacy al catálogo de este prefijo.`,
                            'success'
                        );
                        data = await getMovimientos(selectedPrefixId);
                    }
                }
                setAutoRecoveredPrefixes(prev => new Set(prev).add(selectedPrefixId));
            }

            setMovimientos(data);
        } catch (error) {
            addToast('Error al cargar catálogo de movimientos', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenCreate = () => {
        setModalMode('create');
        setFormId('');
        setFormCodigo('');
        setFormNombre('');
        setFormNaturaleza(Naturaleza.HONORARIO);
        setFormRegimenIva(RegimenIVA.SUJETO);
        setFormIvaDefecto(21);
        setFormAfectaIva(true);
        setFormSubcategoriaSuplido('');
        setShowSubcategoriaError(false);
        setFormPermitirExcepcionIva(false);
        setFormMotivoExencion('');
        setFormIsActive(true);
        setFormImportePorDefecto(0);
        setFormCuentas([]);
        setActiveTab('general');
        setIsModalOpen(true);
    };

    const handleOpenEdit = async (mov: Movimiento) => {
        setModalMode('edit');
        setFormId(mov.id);
        setFormCodigo(mov.codigo);
        setFormNombre(mov.nombre);
        setFormNaturaleza(mov.naturaleza);
        setFormRegimenIva(mov.regimenIva);
        setFormIvaDefecto(mov.ivaPorDefecto || 0);
        setFormAfectaIva(mov.afectaIva);
        setFormSubcategoriaSuplido((mov.subcategoriaSuplido as SubcategoriaSuplido) || '');
        setShowSubcategoriaError(false);
        setFormPermitirExcepcionIva(mov.permitirExcepcionIva || false);
        setFormMotivoExencion(mov.motivoExencion || '');
        setFormIsActive(mov.activo);
        setFormImportePorDefecto(mov.importePorDefecto || 0);

        // Load accounting accounts
        try {
            const cuentas = await getCuentasContables(mov.id);
            setFormCuentas(cuentas);
        } catch (error) {
            setFormCuentas([]);
        }

        setActiveTab('general');
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        const isSuplido = formNaturaleza === Naturaleza.SUPLIDO;
        const isEntregaCuenta = formNaturaleza === Naturaleza.ENTREGA_A_CUENTA;
        const isSujeto = formRegimenIva === RegimenIVA.SUJETO;
        const normalizedSubcategoriaRaw = typeof formSubcategoriaSuplido === 'string'
            ? formSubcategoriaSuplido.trim()
            : '';
        const normalizedSubcategoria = normalizedSubcategoriaRaw as SubcategoriaSuplido | '';

        if (isSuplido && !normalizedSubcategoria) {
            addToast('Para guardar un suplido debes seleccionar una subcategoría obligatoria.', 'warning');
            setShowSubcategoriaError(true);
            setActiveTab('general');
            setTimeout(() => {
                suplidoSubcategoriaRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }, 0);
            return;
        }

        const normalizedRegimen = (isSuplido || isEntregaCuenta) ? RegimenIVA.NO_SUJETO : formRegimenIva;
        const normalizedIvaPorDefecto = isSuplido ? null : (isSujeto ? formIvaDefecto : null);
        const normalizedAfectaIva = isSuplido ? false : formAfectaIva;

        const data: Partial<Movimiento> = {
            codigo: formCodigo,
            nombre: formNombre,
            naturaleza: formNaturaleza,
            regimenIva: normalizedRegimen,
            ivaPorDefecto: normalizedIvaPorDefecto,
            afectaIva: normalizedAfectaIva,
            ...(isSuplido && normalizedSubcategoria
                ? { subcategoriaSuplido: normalizedSubcategoria }
                : {}),
            afectaFactura: true, // All movements affect invoices
            imprimibleEnFactura: true, // All movements are printable
            permitirExcepcionIva: formPermitirExcepcionIva,
            motivoExencion: formMotivoExencion,
            importePorDefecto: formImportePorDefecto,
            activo: formIsActive
        };

        try {
            if (modalMode === 'create') {
                await createMovimiento(selectedPrefixId, { ...data, prefixId: selectedPrefixId } as any);
                addToast('Movimiento creado correctamente', 'success');
            } else {
                await updateMovimiento(selectedPrefixId, formId, data);
                addToast('Movimiento actualizado correctamente', 'success');
            }
            setIsModalOpen(false);
            loadData();
        } catch (error: any) {
            addToast(error.message || 'Error al guardar movimiento', 'error');
        }
    };

    useEffect(() => {
        // Reglas automáticas para evitar errores de validación.
        if (formNaturaleza === Naturaleza.SUPLIDO) {
            setFormRegimenIva(RegimenIVA.NO_SUJETO);
            setFormAfectaIva(false);
            return;
        }

        if (formNaturaleza === Naturaleza.ENTREGA_A_CUENTA) {
            setFormRegimenIva(RegimenIVA.NO_SUJETO);
            setFormAfectaIva(false);
            setFormSubcategoriaSuplido('');
            return;
        }

        // Si volvemos a honorario, limpiamos subcategoría de suplido.
        setFormSubcategoriaSuplido('');
        setShowSubcategoriaError(false);
    }, [formNaturaleza]);

    useEffect(() => {
        if (formSubcategoriaSuplido) {
            setShowSubcategoriaError(false);
        }
    }, [formSubcategoriaSuplido]);

    const handleDelete = async (id: string) => {
        const confirmed = await confirm({
            title: 'Desactivar movimiento',
            message: '¿Desea desactivar este movimiento?',
            description: 'Los movimientos no se borran físicamente para mantener la trazabilidad.',
            confirmText: 'Desactivar',
            cancelText: 'Cancelar',
            variant: 'warning'
        });
        if (!confirmed) return;

        try {
            await softDeleteMovimiento(selectedPrefixId, id);
            addToast('Movimiento desactivado', 'success');
            loadData();
        } catch (error: any) {
            addToast(error.message || 'Error al desactivar movimiento', 'error');
        }
    };

    const handleRunMigration = async () => {
        if (!selectedPrefixId) {
            addToast('Seleccione primero el prefijo de destino', 'error');
            return;
        }

        const targetPrefix = prefixes.find(p => p.id === selectedPrefixId);
        if (!targetPrefix) return;

        const confirmed = await confirm({
            title: 'Recuperar catálogo antiguo',
            message: `¿Desea recuperar los movimientos del catálogo antiguo y moverlos al prefijo "${targetPrefix.code}"?`,
            description: 'Se incorporarán al prefijo seleccionado para su uso en operaciones nuevas.',
            confirmText: 'Recuperar',
            cancelText: 'Cancelar',
            variant: 'info'
        });
        if (!confirmed) return;

        setLoading(true);
        try {
            const result = await migrateGlobalMovementsToPrefix(targetPrefix.id);
            if (result.migrated > 0) {
                addToast(`Recuperación completada: ${result.migrated} movimientos añadidos a ${targetPrefix.code}`, 'success');
                loadData();
            } else {
                addToast('No se encontraron movimientos antiguos para migrar o ya estaban en este prefijo', 'info');
            }
        } catch (error: any) {
            addToast(error.message || 'Error durante la migración', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsImporting(true);
        try {
            const report = await importEconomicModelFromExcel(file);
            setImportReport(report);
            setIsReportOpen(true);
            addToast('Importación finalizada. Revise el reporte.', 'success');
            loadData();
        } catch (error) {
            addToast('Error crítico durante la importación', 'error');
        } finally {
            setIsImporting(false);
            e.target.value = ''; // Reset input
        }
    };

    const filteredMovimientos = movimientos.filter(mov => {
        const matchesSearch = mov.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
            mov.codigo.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesNaturaleza = filterNaturaleza === 'ALL' || mov.naturaleza === filterNaturaleza;
        const matchesStatus = showInactive || mov.activo;
        return matchesSearch && matchesNaturaleza && matchesStatus;
    });

    return (
        <div className={`flex h-full w-full bg-slate-50 overflow-hidden font-sans ${embedded ? '!bg-transparent' : ''}`}>
            <main className={`flex-1 flex flex-col min-w-0 bg-white shadow-sm ${embedded ? 'border-none shadow-none !bg-transparent' : 'border-l border-slate-200'}`}>
                {/* Header Section */}
                {!embedded && (
                    <div className="px-10 py-8 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
                        <div className="flex items-center gap-6">
                            <div>
                                <h2 className="text-[#0d141b] tracking-tight text-[28px] font-bold leading-tight flex items-center gap-3">
                                    <Calculator className="w-8 h-8 text-sky-500" />
                                    Catálogo de Movimientos
                                </h2>
                                <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1 font-black flex items-center gap-2">
                                    <ShieldCheck className="w-3 h-3 text-emerald-500" /> Modelización Económica Blindada
                                </p>
                            </div>
                            <div className="h-12 w-px bg-slate-100 hidden md:block" />

                            {/* PREFIX SELECTOR (Visible only if not hidden) */}
                            {!hidePrefixSelector && (
                                <div className="flex flex-col gap-1">
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Prefijo de Expediente</label>
                                    <select
                                        value={selectedPrefixId}
                                        onChange={(e) => setSelectedPrefixId(e.target.value)}
                                        className="bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-2 text-xs font-black text-slate-700 outline-none focus:border-sky-500 transition-all min-w-[150px]"
                                    >
                                        {prefixes.map(p => (
                                            <option key={p.id} value={p.id}>{p.code} - {p.description}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {!hidePrefixSelector && <div className="h-12 w-px bg-slate-100 hidden md:block" />}
                            <div className="hidden lg:flex items-center gap-4 text-xs">
                                <div className="flex flex-col">
                                    <span className="text-slate-400 font-bold uppercase text-[9px]">Total Items</span>
                                    <span className="text-slate-900 font-black">{movimientos.length}</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-slate-400 font-bold uppercase text-[9px]">Activos</span>
                                    <span className="text-emerald-600 font-black">{movimientos.filter(m => m.activo).length}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <button
                                onClick={handleRunMigration}
                                className="flex items-center gap-2 px-6 py-3 bg-white border-2 border-amber-100 rounded-2xl text-[10px] font-black uppercase tracking-widest text-amber-500 hover:border-amber-200 hover:bg-amber-50 transition-all shadow-sm"
                                title="Recuperar movimientos del catálogo antiguo al prefijo actual"
                            >
                                <History className="w-4 h-4" />
                                Recuperar Catálogo Antiguo
                            </button>
                            <label className="cursor-pointer">
                                <input
                                    type="file"
                                    accept=".xlsx, .xls"
                                    className="hidden"
                                    onChange={handleImportExcel}
                                    disabled={isImporting}
                                />
                                <div className={`flex items-center gap-2 px-6 py-3 bg-white border-2 border-slate-100 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:border-sky-200 hover:text-sky-600 transition-all shadow-sm ${isImporting ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    <Upload className={`w-4 h-4 ${isImporting ? 'animate-bounce' : ''}`} />
                                    {isImporting ? 'Procesando...' : 'Migración Excel'}
                                </div>
                            </label>
                            <Button
                                onClick={handleOpenCreate}
                                variant="primary"
                                icon={Plus}
                                className="!rounded-2xl shadow-lg shadow-sky-500/20"
                                disabled={!selectedPrefixId}
                            >
                                Nuevo Movimiento
                            </Button>
                        </div>
                    </div>
                )}

                {/* Filters Bar */}
                <div className="px-10 py-4 bg-slate-50/30 border-b border-slate-100 flex items-center gap-4 shrink-0 overflow-x-auto no-scrollbar">
                    <div className="relative flex-1 max-w-md min-w-[200px]">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar por código o nombre..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm focus:border-sky-500 focus:ring-4 focus:ring-sky-500/5 outline-none transition-all"
                        />
                    </div>

                    <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200">
                        {['ALL', Naturaleza.HONORARIO, Naturaleza.SUPLIDO, Naturaleza.ENTREGA_A_CUENTA].map(nat => (
                            <button
                                key={nat}
                                onClick={() => setFilterNaturaleza(nat)}
                                className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${filterNaturaleza === nat ? 'bg-sky-500 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                                {nat === 'ALL' ? 'Todos' : nat.replace(/_/g, ' ')}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={() => setShowInactive(!showInactive)}
                        className={`px-4 py-3 rounded-xl border-2 transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${showInactive ? 'bg-rose-50 border-rose-100 text-rose-600' : 'bg-white border-slate-100 text-slate-400'}`}
                    >
                        <History className="w-4 h-4" /> Mostrar Inactivos
                    </button>

                    {embedded && (
                        <Button
                            onClick={handleOpenCreate}
                            variant="primary"
                            icon={Plus}
                            className="!rounded-2xl shadow-lg shadow-sky-500/20 ml-auto"
                            disabled={!selectedPrefixId}
                        >
                            Nuevo Movimiento
                        </Button>
                    )}
                </div>

                {/* Catalog Table */}
                <div className="flex-1 overflow-auto px-10 py-6">
                    <div className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-sm">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="bg-slate-50/50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                                    <th className="px-8 py-5">Código</th>
                                    <th className="px-6 py-5">Nombre / Descripción</th>
                                    <th className="px-6 py-5 text-center">Naturaleza</th>
                                    <th className="px-6 py-5 text-center">IVA</th>
                                    <th className="px-6 py-5 text-center">Estado</th>
                                    <th className="px-8 py-5 text-right w-40">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredMovimientos.map(mov => (
                                    <tr
                                        key={mov.id}
                                        className="group hover:bg-slate-50/50 transition-colors cursor-pointer"
                                        onClick={() => handleOpenEdit(mov)}
                                    >
                                        <td className="px-8 py-6">
                                            <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-[11px] font-black font-mono tracking-widest ring-1 ring-slate-200/50 uppercase">
                                                {mov.codigo}
                                            </span>
                                        </td>
                                        <td className="px-6 py-6 font-bold text-slate-800 text-sm">
                                            {mov.nombre}
                                        </td>
                                        <td className="px-6 py-6 text-center">
                                            <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${mov.naturaleza === Naturaleza.HONORARIO ? 'bg-indigo-50 text-indigo-600' :
                                                mov.naturaleza === Naturaleza.SUPLIDO ? 'bg-amber-50 text-amber-600' :
                                                    'bg-emerald-50 text-emerald-600'
                                                }`}>
                                                {mov.naturaleza.replace(/_/g, ' ')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-6 text-center">
                                            <div className="flex flex-col items-center">
                                                <span className={`text-[10px] font-black uppercase ${mov.regimenIva === RegimenIVA.SUJETO ? 'text-sky-600' : 'text-slate-400'}`}>
                                                    {mov.regimenIva}
                                                </span>
                                                {mov.regimenIva === RegimenIVA.SUJETO && (
                                                    <span className="text-[9px] font-bold text-sky-400 opacity-60">({mov.ivaPorDefecto}%)</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-6 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <div className={`w-2 h-2 rounded-full ${mov.activo ? 'bg-emerald-500' : 'bg-slate-300 shadow-none'}`} />
                                                <span className={`text-[10px] font-black uppercase ${mov.activo ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                    {mov.activo ? 'Activo' : 'Inactivo'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6 text-right" onClick={e => e.stopPropagation()}>
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleOpenEdit(mov)}
                                                    className="p-3 bg-white border border-slate-100 text-slate-400 hover:text-sky-600 hover:border-sky-200 hover:bg-sky-50 rounded-2xl transition-all shadow-sm"
                                                    title="Ver / Editar"
                                                >
                                                    <Eye className="w-5 h-5" />
                                                </button>
                                                {mov.activo && (
                                                    <button
                                                        onClick={() => handleDelete(mov.id)}
                                                        className="p-3 bg-white border border-slate-100 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 rounded-2xl transition-all shadow-sm"
                                                        title="Desactivar"
                                                    >
                                                        <Trash2 className="w-5 h-5" />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filteredMovimientos.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="py-32 text-center">
                                            <div className="max-w-xs mx-auto">
                                                <div className="w-16 h-16 bg-slate-50 rounded-[20px] flex items-center justify-center mx-auto mb-6">
                                                    <Search className="w-8 h-8 text-slate-200" />
                                                </div>
                                                <p className="text-slate-900 font-bold text-lg mb-2">No se encontraron movimientos</p>
                                                <p className="text-slate-400 text-sm">Ajuste los filtros o cree un <br />nuevo movimiento para empezar.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>

            {/* Edit / Create Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 py-8 overflow-hidden animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-4xl max-h-full rounded-[40px] shadow-2xl overflow-hidden flex flex-col scale-in-center animate-in zoom-in-95 duration-300">
                        {/* Modal Header */}
                        <div className="p-10 pb-6 flex items-center justify-between shrink-0">
                            <div>
                                <h3 className="text-2xl font-black text-slate-900 flex items-center gap-3 italic tracking-tight">
                                    <div className="w-10 h-10 bg-sky-100 rounded-2xl flex items-center justify-center">
                                        <Calculator className="w-6 h-6 text-sky-600" />
                                    </div>
                                    {modalMode === 'create' ? 'Nuevo Movimiento' : 'Configuración de Movimiento'}
                                </h3>
                                <div className="flex items-center gap-3 mt-3">
                                    <button
                                        onClick={() => setActiveTab('general')}
                                        className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'general' ? 'bg-slate-900 text-white shadow-xl shadow-slate-900/10' : 'text-slate-400 hover:bg-slate-100'}`}
                                    >
                                        Datos Generales
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('accounting')}
                                        className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'accounting' ? 'bg-slate-900 text-white shadow-xl shadow-slate-900/10' : 'text-slate-400 hover:bg-slate-100'}`}
                                    >
                                        Cuentas Contables
                                    </button>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="w-12 h-12 flex items-center justify-center bg-slate-50 text-slate-400 hover:bg-rose-50 hover:text-rose-500 rounded-2xl transition-all border border-slate-100"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="flex-1 overflow-y-auto p-10 pt-0 custom-scrollbar">
                            {activeTab === 'general' && (
                                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                    {/* SECCIÓN 1: NATURALEZA Y IDENTIFICACIÓN */}
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between px-2">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Naturaleza del Movimiento</label>
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
                                                <span className="text-[9px] font-bold text-sky-600 uppercase tracking-tight">Selección Obligatoria</span>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4">
                                            {[Naturaleza.HONORARIO, Naturaleza.SUPLIDO, Naturaleza.ENTREGA_A_CUENTA].map(nat => (
                                                <button
                                                    key={nat}
                                                    onClick={() => setFormNaturaleza(nat)}
                                                    className={`flex items-center justify-center gap-4 p-6 rounded-[24px] border-2 transition-all ${formNaturaleza === nat ? 'bg-sky-500 text-white border-sky-600 shadow-xl shadow-sky-500/20' : 'bg-white border-slate-100 hover:border-slate-200 text-slate-500'}`}
                                                >
                                                    <span className="text-xs font-black uppercase tracking-widest">{nat.replace(/_/g, ' ')}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* SECCIÓN 2: DATOS CORE (FULL WIDTH) */}
                                    <div className="bg-slate-50 border-2 border-slate-100 rounded-[40px] p-10 space-y-10">
                                        <div className="grid grid-cols-12 gap-8 items-start">
                                            {/* CÓDIGO */}
                                            <div className="col-span-3 space-y-3">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 flex items-center gap-2">
                                                    Código <ArrowRight className="w-3 h-3 text-sky-400" />
                                                </label>
                                                <input
                                                    type="text"
                                                    value={formCodigo}
                                                    onChange={e => setFormCodigo(e.target.value)}
                                                    placeholder="Ej: HON-RENTA"
                                                    className="w-full bg-white border-2 border-white rounded-[24px] px-6 py-5 text-sm font-black text-slate-800 outline-none focus:border-sky-500 transition-all font-mono uppercase tracking-widest shadow-sm ring-1 ring-slate-100"
                                                />
                                            </div>

                                            {/* NOMBRE COMERCIAL */}
                                            <div className="col-span-6 space-y-3">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Nombre Comercial / Trámite</label>
                                                <textarea
                                                    value={formNombre}
                                                    onChange={e => setFormNombre(e.target.value)}
                                                    onInput={e => {
                                                        const target = e.target as HTMLTextAreaElement;
                                                        target.style.height = 'auto';
                                                        target.style.height = `${target.scrollHeight}px`;
                                                    }}
                                                    placeholder="Ej: Honorarios Renta Persona Física..."
                                                    rows={1}
                                                    className="w-full bg-white border-2 border-white rounded-[24px] px-8 py-5 text-lg font-black text-slate-900 outline-none focus:border-sky-500 transition-all shadow-sm ring-1 ring-slate-100 min-h-[64px] resize-none leading-tight placeholder:text-slate-300 overflow-hidden"
                                                />
                                            </div>

                                            {/* HONORARIOS */}
                                            <div className="col-span-3 space-y-3">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 text-right block mr-1">Honorarios Predefinidos</label>
                                                <div className="relative">
                                                    <PremiumNumericInput
                                                        value={formImportePorDefecto}
                                                        onChange={val => setFormImportePorDefecto(Math.max(0, val))}
                                                        className="w-full bg-white border-2 border-white rounded-[24px] px-10 py-5 text-xl font-black text-sky-600 outline-none focus:border-sky-500 transition-all shadow-sm ring-1 ring-slate-100"
                                                        placeholder="0,00"
                                                        textAlign="right"
                                                    />
                                                    <Euro className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-sky-300" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* SECCIÓN 3: CONFIGURACIÓN FISCAL */}
                                    <div className="bg-indigo-50/20 border-2 border-indigo-100 rounded-[40px] p-10">
                                        <div className="grid grid-cols-12 gap-10 items-start">
                                            {/* REGIMEN */}
                                            <div className="col-span-12 lg:col-span-7 space-y-4">
                                                <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest ml-1">Régimen Fiscal (IVA)</label>
                                                <div className="flex gap-3">
                                                    {[RegimenIVA.SUJETO, RegimenIVA.EXENTO, RegimenIVA.NO_SUJETO].map(reg => (
                                                        <button
                                                            key={reg}
                                                            onClick={() => setFormRegimenIva(reg)}
                                                            disabled={formNaturaleza === Naturaleza.SUPLIDO || formNaturaleza === Naturaleza.ENTREGA_A_CUENTA}
                                                            className={`flex-1 py-4 rounded-[20px] border-2 text-[10px] font-black uppercase tracking-widest transition-all ${formRegimenIva === reg ? 'bg-indigo-600 text-white border-indigo-700 shadow-lg' : 'bg-white border-indigo-100/50 text-indigo-400 hover:bg-indigo-50'}`}
                                                        >
                                                            {reg.replace(/_/g, ' ')}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* IVA % & AFECTA */}
                                            <div className="col-span-12 lg:col-span-5 flex items-end gap-6 h-full">
                                                {formRegimenIva === RegimenIVA.SUJETO && (
                                                    <div className="grid grid-cols-2 gap-6 w-full animate-in zoom-in-95 duration-200">
                                                        <div className="space-y-2">
                                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">% IVA Defecto</label>
                                                            <div className="relative">
                                                                <PremiumNumericInput
                                                                    value={formIvaDefecto}
                                                                    onChange={val => setFormIvaDefecto(val)}
                                                                    className="w-full bg-white border-2 border-indigo-100 rounded-[20px] px-6 py-4 text-base font-black text-slate-700 outline-none focus:border-indigo-500"
                                                                    placeholder="21"
                                                                />
                                                                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-black text-indigo-300">%</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center justify-center pt-8">
                                                            <label className="flex items-center gap-4 cursor-pointer group">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={formAfectaIva}
                                                                    onChange={e => setFormAfectaIva(e.target.checked)}
                                                                    className="w-6 h-6 rounded-lg border-indigo-200 text-indigo-600 focus:ring-indigo-500"
                                                                />
                                                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest group-hover:text-indigo-600 transition-colors">Afecta IVA</span>
                                                            </label>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {formNaturaleza === Naturaleza.HONORARIO && formRegimenIva !== RegimenIVA.SUJETO && (
                                            <div className="mt-8 p-8 bg-white border-2 border-amber-100 rounded-[32px] animate-in slide-in-from-top-4 duration-300">
                                                <div className="flex items-center gap-4 mb-6">
                                                    <div className="p-3 bg-amber-50 rounded-2xl">
                                                        <AlertTriangle className="w-6 h-6 text-amber-600" />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-black text-amber-900 uppercase tracking-tight">Protocolo de Exención de IVA</span>
                                                        <p className="text-[10px] text-amber-500 font-bold uppercase tracking-widest">Validación Legal Requerida</p>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                                                    <div className="lg:col-span-4">
                                                        <label className="flex items-center gap-4 cursor-pointer p-4 bg-amber-50/50 rounded-2xl border-2 border-transparent hover:border-amber-200 transition-all">
                                                            <input
                                                                type="checkbox"
                                                                checked={formPermitirExcepcionIva}
                                                                onChange={e => setFormPermitirExcepcionIva(e.target.checked)}
                                                                className="w-6 h-6 rounded-lg border-amber-300 text-amber-600"
                                                            />
                                                            <span className="text-xs font-black text-amber-800 uppercase tracking-widest">Activar Excepción</span>
                                                        </label>
                                                    </div>
                                                    <div className="lg:col-span-8">
                                                        {formPermitirExcepcionIva && (
                                                            <textarea
                                                                value={formMotivoExencion}
                                                                onChange={e => setFormMotivoExencion(e.target.value)}
                                                                placeholder="Especifique el fundamento jurídico que ampara esta exención..."
                                                                className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-6 text-sm font-bold text-slate-700 outline-none focus:border-amber-500 focus:bg-white transition-all shadow-inner"
                                                                rows={2}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {formNaturaleza === Naturaleza.SUPLIDO && (
                                            <div ref={suplidoSubcategoriaRef} className={`mt-8 p-8 bg-white border-2 rounded-[32px] animate-in slide-in-from-top-4 duration-300 ${showSubcategoriaError
                                                ? 'border-rose-300 ring-4 ring-rose-100'
                                                : 'border-amber-100'
                                                }`}>
                                                <div className="flex items-center gap-4 mb-6">
                                                    <div className={`p-3 rounded-2xl ${showSubcategoriaError ? 'bg-rose-50' : 'bg-amber-50'}`}>
                                                        <AlertTriangle className={`w-6 h-6 ${showSubcategoriaError ? 'text-rose-600' : 'text-amber-600'}`} />
                                                    </div>
                                                    <div>
                                                        <span className={`text-sm font-black uppercase tracking-tight ${showSubcategoriaError ? 'text-rose-900' : 'text-amber-900'}`}>Subcategoría de Suplido</span>
                                                        <p className={`text-[10px] font-bold uppercase tracking-widest ${showSubcategoriaError ? 'text-rose-600' : 'text-amber-600'}`}>
                                                            {showSubcategoriaError ? 'Debes seleccionar una subcategoría para guardar' : 'Campo obligatorio'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    {SUBCATEGORIAS_SUPLIDOS_FISCAL.map(subcat => (
                                                        <button
                                                            key={subcat}
                                                            onClick={() => {
                                                                setFormSubcategoriaSuplido(subcat);
                                                                setShowSubcategoriaError(false);
                                                            }}
                                                            className={`px-4 py-3 text-left rounded-2xl border-2 transition-all text-xs font-bold ${formSubcategoriaSuplido === subcat
                                                                ? 'bg-amber-500 text-white border-amber-600 shadow-md'
                                                                : 'bg-white text-slate-700 border-amber-100 hover:bg-amber-50'
                                                                }`}
                                                        >
                                                            {subcat}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'accounting' && (
                                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
                                    <div className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm">
                                        <div className="flex items-center justify-between mb-8">
                                            <div>
                                                <h4 className="text-xl font-black text-slate-900 tracking-tight">Mapeo de Cuentas Contables</h4>
                                                <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1 font-bold">Defina el comportamiento operacional en el Libro Diario</p>
                                            </div>
                                            <ShieldCheck className="w-10 h-10 text-emerald-500" />
                                        </div>

                                        <div className="grid grid-cols-1 gap-4">
                                            {/* We will build a dynamic list of roles based on nature */}
                                            {Object.values(RolCuenta).map(rol => {
                                                const currentCuenta = formCuentas.find(c => c.rol === rol);
                                                return (
                                                    <div key={rol} className="flex items-center gap-6 bg-slate-50 border-2 border-slate-200 rounded-2xl p-6 group hover:bg-slate-100 transition-all border-l-4 border-l-sky-500">
                                                        <div className="w-40 flex flex-col">
                                                            <span className="text-[10px] font-black text-sky-600 uppercase tracking-widest">{rol.replace(/_/g, ' ')}</span>
                                                            <span className="text-[9px] text-slate-400 mt-1 uppercase font-bold">Cuenta Operacional</span>
                                                        </div>
                                                        <div className="flex-1">
                                                            <input
                                                                type="text"
                                                                value={currentCuenta?.cuentaContable || ''}
                                                                onChange={e => {
                                                                    const val = e.target.value;
                                                                    const newCuentas = [...formCuentas];
                                                                    const idx = newCuentas.findIndex(c => c.rol === rol);
                                                                    if (idx > -1) {
                                                                        newCuentas[idx].cuentaContable = val;
                                                                    } else {
                                                                        newCuentas.push({ rol, cuentaContable: val, movimientoId: formId });
                                                                    }
                                                                    setFormCuentas(newCuentas);
                                                                }}
                                                                placeholder="700.XXXXX"
                                                                className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-mono text-slate-900 outline-none focus:border-sky-500 tracking-wider placeholder:text-slate-400 transition-all"
                                                            />
                                                        </div>
                                                        <div className="flex-1">
                                                            <input
                                                                type="text"
                                                                value={currentCuenta?.descripcion || ''}
                                                                onChange={e => {
                                                                    const val = e.target.value;
                                                                    const newCuentas = [...formCuentas];
                                                                    const idx = newCuentas.findIndex(c => c.rol === rol);
                                                                    if (idx > -1) {
                                                                        newCuentas[idx].descripcion = val;
                                                                    } else {
                                                                        newCuentas.push({ rol, descripcion: val, movimientoId: formId });
                                                                    }
                                                                    setFormCuentas(newCuentas);
                                                                }}
                                                                placeholder="Nombre de la cuenta para el asiento..."
                                                                className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-sky-500 placeholder:text-slate-400 transition-all"
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl p-6 flex items-start gap-4">
                                        <AlertTriangle className="w-6 h-6 text-blue-600 mt-1" />
                                        <div className="text-blue-900">
                                            <p className="font-bold text-sm">Nota sobre Esquema Contable</p>
                                            <p className="text-xs mt-1 leading-relaxed">
                                                Al registrar un movimiento de este tipo, el sistema generará automáticamente los apuntes en el Libro Diario
                                                utilizando estas cuentas. Verifique que los códigos coincidan con su Plan General Contable (PGC).
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Actions */}
                        <div className="p-10 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
                            <div>
                                {modalMode === 'edit' && (
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${formIsActive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                        <button
                                            onClick={() => setFormIsActive(!formIsActive)}
                                            className={`text-[9px] font-black uppercase tracking-widest ${formIsActive ? 'text-emerald-600 hover:text-emerald-700' : 'text-rose-600 hover:text-rose-700'}`}
                                        >
                                            {formIsActive ? 'Movimiento Activo' : 'Movimiento Inactivo'} (Cambiar)
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-4">
                                <Button
                                    variant="outline"
                                    onClick={() => setIsModalOpen(false)}
                                    className="!rounded-2xl !px-10"
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    variant="primary"
                                    onClick={handleSave}
                                    icon={Save}
                                    className="!rounded-2xl !px-12 shadow-xl shadow-sky-500/20"
                                >
                                    {modalMode === 'create' ? 'Crear Movimiento' : 'Guardar Cambios'}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Migration Report Modal */}
            {isReportOpen && importReport && (
                <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[200] flex items-center justify-center p-6 animate-in fade-in duration-300">
                    <div className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden flex flex-col scale-in-center">
                        <div className="p-10 border-b border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${importReport.success ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                                    {importReport.success ? <CheckCircle2 className="w-7 h-7" /> : <AlertTriangle className="w-7 h-7" />}
                                </div>
                                <h3 className="text-xl font-black text-slate-900 uppercase">Reporte de Migración</h3>
                            </div>
                            <button onClick={() => setIsReportOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        <div className="p-10 space-y-8 overflow-y-auto max-h-[60vh] custom-scrollbar">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Movimientos</span>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-2xl font-black text-slate-900">{importReport.summary.movimientosCreated}</span>
                                        <span className="text-[10px] font-bold text-slate-400">CREADOS</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-2 opacity-60">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                        <span className="text-[9px] font-bold text-slate-500 uppercase">{importReport.summary.movimientosSkipped} DUPLICADOS</span>
                                    </div>
                                </div>
                                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Prefijos</span>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-2xl font-black text-slate-900">{importReport.summary.prefixesCreated}</span>
                                        <span className="text-[10px] font-bold text-slate-400">CREADOS</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-2 opacity-60">
                                        <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                                        <span className="text-[9px] font-bold text-slate-500 uppercase">{importReport.summary.relationsCreated} TAREAS VINCULADAS</span>
                                    </div>
                                </div>
                            </div>

                            {importReport.errors.length > 0 && (
                                <div className="space-y-3">
                                    <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest ml-4">Errores Críticos ({importReport.errors.length})</span>
                                    <div className="bg-rose-50 border border-rose-100 rounded-2xl p-6 space-y-2">
                                        {importReport.errors.map((err, i) => (
                                            <p key={i} className="text-[11px] font-bold text-rose-900 flex items-start gap-2">
                                                <span className="text-rose-400 shrink-0 select-none">•</span> {err}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {importReport.warnings.length > 0 && (
                                <div className="space-y-3">
                                    <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest ml-4">Advertencias / Duplicados ({importReport.warnings.length})</span>
                                    <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 space-y-2">
                                        {importReport.warnings.map((warn, i) => (
                                            <p key={i} className="text-[11px] font-bold text-amber-900 flex items-start gap-2">
                                                <span className="text-amber-400 shrink-0 select-none">•</span> {warn}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-10 bg-slate-50 border-t border-slate-100 text-center">
                            <Button onClick={() => setIsReportOpen(false)} className="!rounded-2xl !px-12">
                                Entendido
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            <ConfirmationModal
                isOpen={confirmationState.isOpen}
                onClose={closeConfirmation}
                onConfirm={confirmationState.onConfirm}
                title={confirmationState.title}
                message={confirmationState.message}
                description={confirmationState.description}
                confirmText={confirmationState.confirmText}
                cancelText={confirmationState.cancelText}
                variant={confirmationState.variant}
            />
        </div>
    );
};

export default MovimientoCatalogManager;
