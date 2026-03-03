import React, { useEffect, useState, useMemo, useRef } from 'react';
import type { ClientCreateInput, ClientType, ClientStatus, Observacion, Domicilio, ContactItem, Administrator } from '@/types';
import { getClientById, createClient, updateClient } from '@/services/clientService';
import { getCasesByClientId } from '@/services/firestoreService';
import type { CaseRecord } from '@/types';
import { User, FileText, RefreshCcw, Plus, MapPin, Landmark, Calendar, Trash2, Copy, Check, Pencil, Save, ChevronRight, X, Archive, Info, Users, ShieldCheck } from 'lucide-react';
import { HeaderActions } from './ui/HeaderActions';
import ConfirmationModal from './ConfirmationModal';
import { CopyAction } from './ui/ActionFeedback';
import { useHashRouter } from '@/hooks/useHashRouter';
import { useToast } from '@/hooks/useToast';
import { useAppContext } from '@/contexts/AppContext';
import { PaymentMethod } from '@/types/paymentMethod';
import { getPaymentMethods } from '@/services/paymentMethodService';
import { Button } from './ui/Button';
import { IdentifierField } from './IdentifierField';
import { calculateNIF, detectClientType } from '@/utils/fiscalUtils';

type Props = {
    clientId: string | null;
    onClose: () => void;
    onSaved: () => void;
    onSelectClient?: (id: string) => void;
};

// -- Feature Flags --
const REQUIRE_CTA = (import.meta as any).env.VITE_REQUIRE_CTA_CONTABLE === "true";

// -- Data for Selects (EKON Style) --
const SIGLAS = ['CL', 'AV', 'PZ', 'CR', 'PSO', 'RBL', 'TRA'];
const PAISES = ['ESPAÑA', 'PORTUGAL', 'FRANCIA', 'ANDORRA'];
const PROVINCIAS_ES = [
    "ÁLAVA", "ALBACETE", "ALICANTE", "ALMERÍA", "ASTURIAS", "ÁVILA", "BADAJOZ", "BARCELONA",
    "BURGOS", "CÁCERES", "CÁDIZ", "CANTABRIA", "CASTELLÓN", "CIUDAD REAL", "CÓRDOBA", "CUENCA",
    "GIRONA", "GRANADA", "GUADALAJARA", "GIPUZKOA", "HUELVA", "HUESCA", "ILLES BALEARS", "JAÉN",
    "A CORUÑA", "LA RIOJA", "LAS PALMAS", "LEÓN", "LLEIDA", "LUGO", "MADRID", "MÁLAGA", "MURCIA",
    "NAVARRA", "OURENSE", "PALENCIA", "PONTEVEDRA", "SALAMANCA", "SANTA CRUZ DE TENERIFE",
    "SEGOVIA", "SEVILLA", "SORIA", "TARRAGONA", "TERUEL", "TOLEDO", "VALENCIA", "VALLADOLID",
    "BIZKAIA", "ZAMORA", "ZARAGOZA", "CEUTA", "MELILLA"
];
const MUNICIPIOS_POR_PROVINCIA: Record<string, string[]> = {
    "ALMERÍA": ["Almería", "Roquetas de Mar", "El Ejido", "Níjar", "Vícar", "Adra", "Huércal-Overa", "Huércal de Almería", "Vera", "Cuevas del Almanzora"],
    "MADRID": ["Madrid", "Alcalá de Henares", "Móstoles", "Fuenlabrada", "Leganés", "Getafe", "Alcorcón", "Torrejón de Ardoz", "Parla", "Alcobendas"],
    "BARCELONA": ["Barcelona", "L'Hospitalet de Llobregat", "Badalona", "Terrassa", "Sabadell", "Mataró", "Santa Coloma de Gramenet", "Cornellà de Llobregat"],
    "VALENCIA": ["Valencia", "Torrent", "Gandia", "Paterna", "Sagunto", "Alzira", "Mislata", "Burjassot"],
    "SEVILLA": ["Sevilla", "Dos Hermanas", "Alcalá de Guadaíra", "Utrera", "Mairena del Aljarafe", "Écija", "La Rinconada"],
    "MÁLAGA": ["Málaga", "Marbella", "Vélez-Málaga", "Mijas", "Fuengirola", "Torremolinos", "Benalmádena", "Estepona"],
};
const BANCOS = [
    { code: '0049', name: 'BANCO SANTANDER' },
    { code: '0182', name: 'BBVA' },
    { code: '2100', name: 'CAIXABANK' },
    { code: '0081', name: 'BANCO SABADELL' },
    { code: '2038', name: 'BANKIA (CAIXABANK)' },
    { code: '0128', name: 'BANKINTER' },
    { code: '0073', name: 'OPENBANK' },
    { code: '0030', name: 'BANCO ESPAÑOL DE CRÉDITO (BANESTO)' },
    { code: '0075', name: 'BANCO POPULAR ESPAÑOL' },
    { code: '0186', name: 'BANCO MEDIOLANUM' },
    { code: '0061', name: 'BANCA MARCH' },
    { code: '0058', name: 'BNP PARIBAS ESPAÑA' },
    { code: '0019', name: 'DEUTSCHE BANK' },
    { code: '0065', name: 'BARCLAYS BANK' },
    { code: '0131', name: 'BANCO CETELEM' },
    { code: '0239', name: 'EVO BANCO' },
    { code: '0122', name: 'CITIBANK ESPAÑA' },
    { code: '0086', name: 'BANCO BNP PARIBAS PERSONAL FINANCE' },
    { code: '3058', name: 'CAJAMAR CAJA RURAL' },
    { code: '2085', name: 'IBERCAJA BANCO' },
    { code: '0234', name: 'BANCO CAMINOS' },
    { code: '2048', name: 'LIBERBANK' },
    { code: '2095', name: 'KUTXABANK' },
    { code: '0237', name: 'BANCO CAIXA GERAL' },
    { code: '3035', name: 'CAJA LABORAL POPULAR' },
    { code: '0216', name: 'BANCO PICHINCHA ESPAÑA' },
    { code: '3190', name: 'CAIXA RURAL ALTEA' },
    { code: '3059', name: 'CAJA RURAL DE NAVARRA' },
    { code: '3023', name: 'CAJA RURAL DE GRANADA' },
];

// -- Address Utilities --

function hasContactAddressData(d: Domicilio) {
    if (!d) return false;
    const fields: (keyof Domicilio)[] = ["via", "provincia", "poblacion", "cp", "pais", "numero", "piso", "puerta"];
    return fields.some((f) => (d[f] ?? "").toString().trim() !== "");
}

interface ClientFormState {
    nombre: string;
    documento: string;
    nif: string;

    // Legacy (kept for internal sync if needed, but we'll use arrays)
    telefono: string;
    email: string;

    // Dynamic lists
    telefonos: ContactItem[];
    emails: ContactItem[];

    // Domicilios
    domicilioFiscal: Domicilio;
    domicilioContacto: Domicilio;
    domicilioContactoIgualFiscal: boolean;

    // Admin
    fechaInicio: string;
    cuentaContable: string;
    bancoCobro: string;
    cuentaCobro: string;
    iban: string;
    bancoRemesa: string;
    formaCobroId: string;
    datosContactoImportadosCCS: string;
    notas: string;
    observaciones: Observacion[];
    tipo: ClientType;
    estado: ClientStatus;
    birthDate: string;
    administrators: Administrator[];

    // Escritura de constitución
    notaria: string;
    notario: string;
    fechaEscritura: string;
    numeroProtocolo: string;
    observacionesEscritura: string;

    // Datos registrales
    registroMercantil: string;
    tomo: string;
    libro: string;
    folio: string;
    hoja: string;
    seccion: string;
    inscripcion: string;
    observacionesRegistro: string;
}

const ClientDetailModal: React.FC<Props> = ({ clientId, onClose, onSaved, onSelectClient }) => {
    const { navigateTo: _navigateTo } = useHashRouter();
    const { addToast } = useToast();
    const { currentUser } = useAppContext();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
    const [showConfirmClose, setShowConfirmClose] = useState(false);
    const [showConfirmVerify, setShowConfirmVerify] = useState(false);
    const [_showNifPreview, _setShowNifPreview] = useState(false);
    const [_showCopyFeedback, _setShowCopyFeedback] = useState(false);
    const [_isDuplicate, _setIsDuplicate] = useState(false);
    const [_duplicateClientName, _setDuplicateClientName] = useState("");
    const [_duplicateClientId, _setDuplicateClientId] = useState<string | null>(null);
    const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
    const [verification, setVerification] = useState<{ by: string; at?: string } | null>(null);

    // Data State
    const [_cases, setCases] = useState<CaseRecord[]>([]);
    const [activeTab, setActiveTab] = useState<'datos' | 'otros' | 'administradores'>('datos');
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

    const [form, setForm] = useState<ClientFormState>({
        nombre: '',
        documento: '',
        nif: '',
        telefono: '',
        email: '',
        telefonos: [{ value: '', label: 'Teléfono 1' }],
        emails: [{ value: '', label: 'Email Principal' }],
        domicilioFiscal: { sigla: 'CL', pais: 'ESPAÑA', provincia: '', poblacion: '', cp: '' },
        domicilioContacto: { sigla: 'CL', pais: 'ESPAÑA', provincia: '', poblacion: '', via: '', cp: '' },
        domicilioContactoIgualFiscal: true,
        fechaInicio: new Date().toISOString().split('T')[0],
        cuentaContable: '',
        bancoCobro: '',
        cuentaCobro: '',
        iban: '',
        bancoRemesa: '',
        formaCobroId: '',
        datosContactoImportadosCCS: '',
        notas: '',
        observaciones: [],
        tipo: 'PARTICULAR',
        estado: 'ACTIVO',
        birthDate: '',
        administrators: [],
        notaria: '',
        notario: '',
        fechaEscritura: '',
        numeroProtocolo: '',
        observacionesEscritura: '',
        registroMercantil: '',
        tomo: '',
        libro: '',
        folio: '',
        hoja: '',
        seccion: '',
        inscripcion: '',
        observacionesRegistro: '',
    });

    const [showConfirmSame, setShowConfirmSame] = useState(false);
    const initialFormRef = useRef<ClientFormState>(form);

    // Observaciones State
    const today = new Date().toISOString().slice(0, 10);
    const [obsFecha, setObsFecha] = useState(today);
    const [obsDescripcion, setObsDescripcion] = useState("");
    const [obsSortDir, setObsSortDir] = useState<"asc" | "desc">("desc");
    const [obsToDeleteIdx, setObsToDeleteIdx] = useState<number | null>(null);
    const obsTextRef = useRef<HTMLTextAreaElement | null>(null);

    const handleObsTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setObsDescripcion(e.target.value);
        // Auto-resize logic
        const el = e.target;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    };

    const updateAdmin = (id: string, updates: Partial<Administrator>) => {
        setForm(prev => ({
            ...prev,
            administrators: prev.administrators.map(a => a.id === id ? { ...a, ...updates } : a)
        }));
    };

    useEffect(() => {
        let cancelled = false;

        async function load() {
            if (clientId) {
                setLoading(true);
                try {
                    const [c, casesData, pMethods] = await Promise.all([
                        getClientById(clientId),
                        getCasesByClientId(clientId),
                        getPaymentMethods()
                    ]);

                    if (cancelled) return;

                    setCases(casesData);
                    setPaymentMethods(pMethods);

                    if (c) {
                        const telArr = c.telefonos?.length ? c.telefonos : (c.telefono ? [{ value: c.telefono, label: 'Teléfono 1' }] : [{ value: '', label: 'Teléfono 1' }]);
                        const mailArr = c.emails?.length ? c.emails : (c.email ? [{ value: c.email, label: 'Email Principal' }] : [{ value: '', label: 'Email Principal' }]);

                        const domFiscal: Domicilio = c.domicilioFiscal ?? {
                            sigla: c.sigla ?? 'CL',
                            via: c.via ?? (c.direccion || ''),
                            pais: c.pais ?? 'ESPAÑA',
                            provincia: c.provincia ?? '',
                            poblacion: c.poblacion ?? '',
                            cp: c.cp ?? ''
                        };

                        const domContacto: Domicilio = c.domicilioContacto ?? (c.domicilioContactoIgualFiscal ? domFiscal : {
                            sigla: 'CL',
                            pais: 'ESPAÑA',
                            provincia: '',
                            poblacion: '',
                            via: '',
                            cp: ''
                        });

                        const newForm: ClientFormState = {
                            nombre: c.nombre ?? '',
                            documento: c.documento ?? '',
                            nif: c.nif ?? calculateNIF(c.documento ?? ''),
                            telefono: c.telefono ?? '',
                            email: c.email ?? '',
                            telefonos: telArr,
                            emails: mailArr,
                            domicilioFiscal: domFiscal,
                            domicilioContacto: domContacto,
                            domicilioContactoIgualFiscal: c.domicilioContactoIgualFiscal ?? true,
                            fechaInicio: c.fechaInicio ?? (c.createdAt ? c.createdAt.split('T')[0] : new Date().toISOString().split('T')[0]),
                            cuentaContable: c.cuentaContable ?? '',
                            bancoCobro: c.bancoCobro ?? '',
                            cuentaCobro: c.cuentaCobro ?? '',
                            iban: c.iban ?? '',
                            bancoRemesa: c.bancoRemesa ?? '',
                            formaCobroId: c.formaCobroId ?? '',
                            datosContactoImportadosCCS: c.datosContactoImportadosCCS ?? '',
                            notas: c.notas ?? '',
                            observaciones: c.observaciones ?? [],
                            tipo: detectClientType(c.documento || ''),
                            estado: (c.estado as ClientStatus) ?? 'ACTIVO' as ClientStatus,
                            birthDate: c.birthDate ?? '',
                            administrators: (c.administrators ?? []).map((adm: any) => ({
                                ...adm,
                                nombre: adm.nombre || `${adm.surnames || ''}, ${adm.firstName || ''}`.replace(/^,\s*/, '').replace(/,\s*$/, '').trim()
                            })),
                            notaria: c.notaria ?? '',
                            notario: c.notario ?? '',
                            fechaEscritura: c.fechaEscritura ?? '',
                            numeroProtocolo: c.numeroProtocolo ?? '',
                            observacionesEscritura: c.observacionesEscritura ?? '',
                            registroMercantil: c.registroMercantil ?? '',
                            tomo: c.tomo ?? '',
                            libro: c.libro ?? '',
                            folio: c.folio ?? '',
                            hoja: c.hoja ?? '',
                            seccion: c.seccion ?? '',
                            inscripcion: c.inscripcion ?? '',
                            observacionesRegistro: c.observacionesRegistro ?? '',
                        };
                        setForm(newForm);
                        setVerification(c.verificadoPor ? { by: c.verificadoPor, at: c.verificadoAt } : null);
                        initialFormRef.current = newForm;
                    }
                } catch (error) {
                    console.error('Error loading client:', error);
                    addToast('Error al cargar datos del cliente', 'error');
                } finally {
                    if (!cancelled) setLoading(false);
                }
            } else {
                setCases([]);
                getPaymentMethods().then(setPaymentMethods);
                setVerification(null);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [clientId, addToast]);

    const handleAddObservation = () => {
        const descripcion = obsDescripcion.trim();
        if (!descripcion) return;

        const nueva: Observacion = {
            fecha: obsFecha || today,
            descripcion,
        };

        setForm((prev) => ({
            ...prev,
            observaciones: [...(prev.observaciones ?? []), nueva],
        }));

        setObsFecha(today);
        setObsDescripcion("");

        // Reset height visually
        if (obsTextRef.current) {
            obsTextRef.current.style.height = "auto";
            obsTextRef.current.style.height = "40px"; // base height = h-10/min-h-10
        }
    };

    const handleRemoveObservation = (index: number) => {
        setObsToDeleteIdx(index);
    };

    const confirmDeleteObservation = () => {
        if (obsToDeleteIdx !== null) {
            setForm(prev => ({
                ...prev,
                observaciones: prev.observaciones.filter((_, i) => i !== obsToDeleteIdx)
            }));
            setObsToDeleteIdx(null);
        }
    };

    const handleCopyObservation = (o: Observacion, idx: number) => {
        const textToCopy = `${o.fecha}: ${o.descripcion}`;
        navigator.clipboard.writeText(textToCopy).then(() => {
            setCopiedIdx(idx);
            setTimeout(() => setCopiedIdx(null), 2000);
        });
    };

    const handleCancel = () => {
        const hasChanges = JSON.stringify(form) !== JSON.stringify(initialFormRef.current);
        if (hasChanges) {
            setShowConfirmClose(true);
        } else {
            onClose();
        }
    };

    const sortedObservaciones = useMemo(() => {
        const list = (form.observaciones ?? []).slice();
        list.sort((a, b) => {
            const da = a.fecha || "";
            const db = b.fecha || "";
            return obsSortDir === "asc" ? da.localeCompare(db) : db.localeCompare(da);
        });
        return list;
    }, [form.observaciones, obsSortDir]);

    const save = async () => {
        const docClean = form.documento.trim();
        if (!form.nombre.trim()) {
            addToast('El nombre es obligatorio', 'error');
            return;
        }
        if (!docClean) {
            addToast('El IDENTIFICADOR es obligatorio', 'error');
            return;
        }

        const ctaClean = form.cuentaContable.trim();
        if (REQUIRE_CTA) {
            if (!ctaClean || ctaClean.length !== 10 || !/^\d+$/.test(ctaClean)) {
                addToast('La Cta. Contable es obligatoria y debe tener exactamente 10 dígitos numéricos', 'error');
                return;
            }
        } else if (ctaClean && (ctaClean.length !== 10 || !/^\d+$/.test(ctaClean))) {
            addToast('Si se informa, la Cta. Contable debe tener exactamente 10 dígitos numéricos', 'error');
            return;
        }

        setSaving(true);
        try {
            // -- Validación de Duplicados --
            if (!clientId) {
                const { findPossibleDuplicates } = await import('@/services/clientService');
                const dupes = await findPossibleDuplicates({ nombre: form.nombre, documento: docClean });
                const exactDupe = dupes.find(d => d.documento === docClean);

                if (exactDupe) {
                    addToast(`Ya existe un cliente con el identificador ${docClean}: ${exactDupe.nombre}`, 'error');
                    setSaving(false);
                    return;
                }
            }

            const firstTel = form.telefonos.find(t => t.value.trim())?.value || '';
            const firstEmail = form.emails.find(e => e.value.trim())?.value || '';

            const payload: ClientCreateInput = {
                nombre: form.nombre,
                documento: docClean,
                nif: form.nif,
                telefono: firstTel,
                email: firstEmail,
                telefonos: form.telefonos,
                emails: form.emails,

                // New structured addresses
                domicilioFiscal: form.domicilioFiscal,
                domicilioContacto: form.domicilioContactoIgualFiscal ? form.domicilioFiscal : form.domicilioContacto,
                domicilioContactoIgualFiscal: form.domicilioContactoIgualFiscal,

                // Legacy fields for compat
                sigla: form.domicilioFiscal.sigla,
                via: form.domicilioFiscal.via,
                pais: form.domicilioFiscal.pais,
                provincia: form.domicilioFiscal.provincia,
                poblacion: form.domicilioFiscal.poblacion,
                cp: form.domicilioFiscal.cp,
                direccion: `${form.domicilioFiscal.sigla} ${form.domicilioFiscal.via}, ${form.domicilioFiscal.cp} ${form.domicilioFiscal.poblacion} (${form.domicilioFiscal.provincia})`,

                fechaInicio: form.fechaInicio,
                cuentaContable: ctaClean,
                bancoCobro: form.bancoCobro,
                cuentaCobro: form.cuentaCobro,
                iban: form.iban,
                bancoRemesa: form.bancoRemesa,
                formaCobroId: form.formaCobroId,
                datosContactoImportadosCCS: form.datosContactoImportadosCCS,
                notas: form.notas,
                observaciones: form.observaciones,
                tipo: form.tipo,
                estado: form.estado,
                birthDate: form.birthDate,
                administrators: form.administrators,
                notaria: form.notaria,
                notario: form.notario,
                fechaEscritura: form.fechaEscritura,
                numeroProtocolo: form.numeroProtocolo,
                observacionesEscritura: form.observacionesEscritura,
                registroMercantil: form.registroMercantil,
                tomo: form.tomo,
                libro: form.libro,
                folio: form.folio,
                hoja: form.hoja,
                seccion: form.seccion,
                inscripcion: form.inscripcion,
                observacionesRegistro: form.observacionesRegistro,
            };

            if (clientId) {
                await updateClient(clientId, payload);
                addToast('Cliente actualizado correctamente', 'success');
            } else {
                await createClient(payload);
                addToast('Cliente creado correctamente', 'success');
            }
            onSaved();
        } catch (error) {
            console.error('Error saving:', error);
            addToast('Error al guardar cliente', 'error');
        } finally {
            setSaving(false);
        }
    };

    const updateForm = <K extends keyof ClientFormState>(key: K, value: ClientFormState[K]) => {
        setForm((f) => ({ ...f, [key]: value }));
    };

    const handleVerificationRequest = () => {
        if (verification?.by) return;
        if (!clientId) {
            addToast('Guarda primero el cliente para poder verificar la ficha.', 'warning');
            return;
        }
        setShowConfirmVerify(true);
    };

    const confirmVerification = async () => {
        if (!clientId) return;
        const verifiedBy = currentUser?.name || currentUser?.id || 'USUARIO';
        const verifiedAt = new Date().toISOString();
        try {
            await updateClient(clientId, {
                verificadoPor: verifiedBy,
                verificadoAt: verifiedAt
            });
            setVerification({ by: verifiedBy, at: verifiedAt });
            addToast(`Cliente verificado por ${verifiedBy}`, 'success');
        } catch (error) {
            console.error('Error setting client verification:', error);
            addToast('No se pudo registrar la verificación del cliente', 'error');
        } finally {
            setShowConfirmVerify(false);
        }
    };

    // Helper Styles
    const labelStyle = "app-label-block";
    const inputStyle = "w-full h-8 px-2 bg-white border-b border-[#cfdbe7] text-sm font-normal text-slate-800 focus:border-[#1380ec] outline-none transition-all placeholder:text-slate-300";
    const selectStyle = "w-full h-8 px-2 bg-white border-b border-[#cfdbe7] text-sm font-normal text-slate-800 focus:border-[#1380ec] outline-none transition-all appearance-none cursor-pointer";

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center z-[999] p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col border border-white/20 overflow-hidden font-sans">

                {/* 1. TOP HEADER (Dense) */}
                <div className="bg-white border-b border-slate-100 flex flex-col shrink-0">
                    <div className="px-8 py-6 flex items-start justify-between">
                        <div className="flex items-start gap-8 flex-1">
                            {/* Icon Box */}
                            <div className="p-4 bg-white border border-slate-100 rounded-lg shadow-sm text-sky-500">
                                <User size={32} strokeWidth={1} />
                            </div>

                            {/* Header Fields (Identificador + NIF + Nombre) */}
                            <div className="flex-1">
                                <div className="flex flex-col md:flex-row items-end">
                                    <div className="flex-none w-full md:w-[240px]">
                                        <IdentifierField
                                            value={form.documento}
                                            onChange={(val, tipo, fullNif) => {
                                                setForm(prev => ({
                                                    ...prev,
                                                    documento: val,
                                                    tipo: tipo || prev.tipo,
                                                    nif: fullNif || prev.nif
                                                }));
                                            }}
                                            onSelectDuplicate={onSelectClient}
                                            excludeId={clientId || undefined}
                                            labelClassName="app-label-block"
                                            inputClassName="text-2xl font-normal text-sky-600 bg-transparent border-none outline-none p-0 w-full placeholder:text-sky-200"
                                            placeholder="DNI o CIF"
                                        />
                                    </div>
                                    <div className="flex-1 min-w-0 border-l border-slate-100 pl-10">
                                        <label className="app-label-block">
                                            APELLIDOS, NOMBRE / RAZÓN SOCIAL
                                        </label>
                                        <input
                                            value={form.nombre}
                                            onChange={e => updateForm('nombre', e.target.value)}
                                            className="text-2xl font-normal text-slate-600 bg-transparent border-none outline-none p-0 w-full uppercase placeholder:text-slate-200 text-ellipsis"
                                            placeholder="APELLIDOS, NOMBRE / RAZÓN SOCIAL"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                            <HeaderActions
                                onPrimary={save}
                                primaryIcon={Save}
                                primaryTooltip={form.estado === 'BAJA' ? 'No se puede guardar un cliente dado de baja' : (saving ? 'Guardando...' : 'Guardar cliente')}
                                isPrimaryLoading={saving}
                                primaryDisabled={form.estado === 'BAJA'}
                                onClose={handleCancel}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleVerificationRequest}
                                disabled={Boolean(verification?.by)}
                                title={verification?.by ? `Verificado por ${verification.by}` : 'Verificar cliente'}
                                className={`h-8 min-w-0 px-2.5 rounded-lg ${verification?.by
                                    ? 'border-emerald-600 text-emerald-700 bg-emerald-100 hover:bg-emerald-100 hover:border-emerald-600'
                                    : 'border-red-500 text-red-600 bg-red-50 hover:bg-red-100 hover:border-red-600 hover:text-red-700'
                                    }`}
                            >
                                <Check size={14} />
                            </Button>
                            <span className={`text-[9px] font-bold uppercase tracking-widest ${verification?.by ? 'text-emerald-700' : 'text-red-600'}`}>
                                {verification?.by ? `Verificado por ${verification.by}` : 'Pendiente de verificar'}
                            </span>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="px-8 flex gap-8 border-t border-slate-50 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                        <button
                            onClick={() => setActiveTab('datos')}
                            className={`app-tab ${activeTab === 'datos' ? 'app-tab-active' : ''}`}
                        >
                            Información General
                        </button>
                        <button
                            onClick={() => setActiveTab('otros')}
                            className={`app-tab ${activeTab === 'otros' ? 'app-tab-active' : ''}`}
                        >
                            Otros datos
                        </button>
                        {form.tipo === 'EMPRESA' && (
                            <button
                                onClick={() => setActiveTab('administradores')}
                                className={`app-tab ${activeTab === 'administradores' ? 'app-tab-active' : ''}`}
                            >
                                Administradores
                            </button>
                        )}
                    </div>
                </div>

                {/* 2. BODY CONTENT */}
                <div className="flex-1 overflow-y-auto bg-white p-6 scrollbar-thin">
                    {loading ? (
                        <div className="flex h-full items-center justify-center text-[#4c739a] gap-2">
                            <RefreshCcw className="animate-spin" size={24} />
                            <span className="text-[11px] font-normal uppercase tracking-widest">Cargando Ficha...</span>
                        </div>
                    ) : activeTab === 'datos' ? (
                        <div className="animate-in slide-in-from-bottom-2 duration-300">
                            {form.estado === 'BAJA' && (
                                <div className="mb-8 p-6 bg-amber-50 border border-amber-100 rounded-[32px] flex items-center gap-6 shadow-xl shadow-amber-500/5">
                                    <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center text-amber-500 shadow-sm border border-amber-50 shrink-0">
                                        <Archive size={28} />
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="text-sm font-black text-amber-900 uppercase tracking-widest mb-1 flex items-center gap-2">
                                            <Info size={14} />
                                            Cliente en Archivo de Bajas
                                        </h4>
                                        <p className="text-[11px] font-bold text-amber-700/70 uppercase tracking-tight leading-relaxed">
                                            Este registro está archivado. La edición de datos está bloqueada para preservar el histórico legal.
                                            Para realizar cambios, primero debes restaurar al cliente desde el panel de Administración.
                                        </p>
                                    </div>
                                </div>
                            )}
                            <div className="space-y-10">

                                {/* SECCIÓN DOMICILIOS */}
                                <div className="flex flex-col gap-10">
                                    {/* DOMICILIO FISCAL */}
                                    <div>
                                        <div className="app-section-header">
                                            <MapPin size={14} className="text-sky-500 opacity-70" />
                                            <h4 className="app-section-title">Domicilio Fiscal</h4>
                                        </div>
                                        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-5">
                                            <div className="grid grid-cols-12 gap-3">
                                                <div className="col-span-3">
                                                    <label className={labelStyle}>Sigla</label>
                                                    <select
                                                        value={form.domicilioFiscal.sigla}
                                                        onChange={e => setForm(prev => ({ ...prev, domicilioFiscal: { ...prev.domicilioFiscal, sigla: e.target.value } }))}
                                                        className={selectStyle}
                                                    >
                                                        {SIGLAS.map(s => <option key={s} value={s}>{s}</option>)}
                                                    </select>
                                                </div>
                                                <div className="col-span-9">
                                                    <label className={labelStyle}>Vía Pública</label>
                                                    <input
                                                        value={form.domicilioFiscal.via}
                                                        onChange={e => setForm(prev => ({ ...prev, domicilioFiscal: { ...prev.domicilioFiscal, via: e.target.value } }))}
                                                        className={inputStyle}
                                                        placeholder="Calle, Avda, Plaza..."
                                                    />
                                                </div>
                                            </div>

                                            {/* Provincia, Población, CP, País en una sola fila */}
                                            <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_90px_140px] gap-3">
                                                <div>
                                                    <label className={labelStyle}>Provincia</label>
                                                    <select
                                                        value={form.domicilioFiscal.provincia}
                                                        onChange={e => {
                                                            const prov = e.target.value;
                                                            setForm(prev => {
                                                                const municipiosDeProv = MUNICIPIOS_POR_PROVINCIA[prov] ?? [];
                                                                const target = prev.domicilioFiscal;
                                                                const isValid = municipiosDeProv.includes(target.poblacion || '');
                                                                return {
                                                                    ...prev,
                                                                    domicilioFiscal: {
                                                                        ...target,
                                                                        provincia: prov,
                                                                        poblacion: isValid ? target.poblacion : ''
                                                                    }
                                                                };
                                                            });
                                                        }}
                                                        className={selectStyle}
                                                    >
                                                        <option value="">- Selecc -</option>
                                                        {PROVINCIAS_ES.map(p => <option key={p} value={p}>{p}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className={labelStyle}>Población</label>
                                                    <input
                                                        list="municipios-fiscal"
                                                        value={form.domicilioFiscal.poblacion}
                                                        onChange={e => setForm(prev => ({ ...prev, domicilioFiscal: { ...prev.domicilioFiscal, poblacion: e.target.value } }))}
                                                        className={inputStyle}
                                                        placeholder="Localidad"
                                                    />
                                                    <datalist id="municipios-fiscal">
                                                        {(MUNICIPIOS_POR_PROVINCIA[form.domicilioFiscal.provincia || ''] || []).map(m => (
                                                            <option key={m} value={m} />
                                                        ))}
                                                    </datalist>
                                                </div>
                                                <div>
                                                    <label className={labelStyle}>C.P.</label>
                                                    <input
                                                        value={form.domicilioFiscal.cp}
                                                        onChange={e => setForm(prev => ({ ...prev, domicilioFiscal: { ...prev.domicilioFiscal, cp: e.target.value } }))}
                                                        className={inputStyle}
                                                        placeholder="00000"
                                                        maxLength={5}
                                                    />
                                                </div>
                                                <div>
                                                    <label className={labelStyle}>País</label>
                                                    <select
                                                        value={form.domicilioFiscal.pais}
                                                        onChange={e => setForm(prev => ({ ...prev, domicilioFiscal: { ...prev.domicilioFiscal, pais: e.target.value } }))}
                                                        className={selectStyle}
                                                    >
                                                        {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* DOMICILIO CONTACTO */}
                                    <div>
                                        <div className="app-section-header !justify-between">
                                            <div className="flex items-center gap-2">
                                                <MapPin size={14} className="text-sky-500 opacity-70" />
                                                <h4 className="app-section-title">Domicilio de Contacto</h4>
                                            </div>
                                            <label className="flex items-center gap-2 cursor-pointer group">
                                                <input
                                                    type="checkbox"
                                                    checked={form.domicilioContactoIgualFiscal}
                                                    onChange={e => {
                                                        const checked = e.target.checked;
                                                        if (checked && !form.domicilioContactoIgualFiscal && hasContactAddressData(form.domicilioContacto)) {
                                                            setShowConfirmSame(true);
                                                        } else {
                                                            setForm(prev => ({
                                                                ...prev,
                                                                domicilioContactoIgualFiscal: checked,
                                                                domicilioContacto: checked ? {} : (prev.domicilioContacto ?? {})
                                                            }));
                                                        }
                                                    }}
                                                    className="w-4 h-4 rounded border-slate-200 text-sky-600 focus:ring-sky-500 transition-all cursor-pointer"
                                                />
                                                <span className="app-label !text-slate-400 group-hover:text-sky-600 transition-colors">Igual que Fiscal</span>
                                            </label>
                                        </div>

                                        {!form.domicilioContactoIgualFiscal && (
                                            <div className="p-4 rounded border transition-colors space-y-4 bg-blue-50/20 border-blue-100 animate-in fade-in slide-in-from-top-1 duration-200">
                                                <div className="grid grid-cols-12 gap-3">
                                                    <div className="col-span-3">
                                                        <label className={labelStyle}>Sigla</label>
                                                        <select
                                                            value={form.domicilioContacto.sigla}
                                                            onChange={e => setForm(prev => ({ ...prev, domicilioContacto: { ...prev.domicilioContacto, sigla: e.target.value } }))}
                                                            className={selectStyle}
                                                        >
                                                            {SIGLAS.map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="col-span-9">
                                                        <label className={labelStyle}>Vía Pública</label>
                                                        <input
                                                            value={form.domicilioContacto.via}
                                                            onChange={e => setForm(prev => ({ ...prev, domicilioContacto: { ...prev.domicilioContacto, via: e.target.value } }))}
                                                            className={inputStyle}
                                                            placeholder="Calle, etc."
                                                        />
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_90px_140px] gap-3">
                                                    <div>
                                                        <label className={labelStyle}>Provincia</label>
                                                        <select
                                                            value={form.domicilioContacto.provincia}
                                                            onChange={e => {
                                                                const prov = e.target.value;
                                                                setForm(prev => {
                                                                    const municipiosDeProv = MUNICIPIOS_POR_PROVINCIA[prov] ?? [];
                                                                    const target = prev.domicilioContacto;
                                                                    const isValid = municipiosDeProv.includes(target.poblacion || '');
                                                                    return {
                                                                        ...prev,
                                                                        domicilioContacto: {
                                                                            ...target,
                                                                            provincia: prov,
                                                                            poblacion: isValid ? target.poblacion : ''
                                                                        }
                                                                    };
                                                                });
                                                            }}
                                                            className={selectStyle}
                                                        >
                                                            <option value="">- Selecc -</option>
                                                            {PROVINCIAS_ES.map(p => <option key={p} value={p}>{p}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className={labelStyle}>Población</label>
                                                        <input
                                                            list="municipios-contacto"
                                                            value={form.domicilioContacto.poblacion}
                                                            onChange={e => setForm(prev => ({ ...prev, domicilioContacto: { ...prev.domicilioContacto, poblacion: e.target.value } }))}
                                                            className={inputStyle}
                                                            placeholder="Localidad"
                                                        />
                                                        <datalist id="municipios-contacto">
                                                            {(MUNICIPIOS_POR_PROVINCIA[form.domicilioContacto.provincia || ''] || []).map(m => (
                                                                <option key={m} value={m} />
                                                            ))}
                                                        </datalist>
                                                    </div>
                                                    <div>
                                                        <label className={labelStyle}>C.P.</label>
                                                        <input
                                                            value={form.domicilioContacto.cp}
                                                            onChange={e => setForm(prev => ({ ...prev, domicilioContacto: { ...prev.domicilioContacto, cp: e.target.value } }))}
                                                            className={inputStyle}
                                                            placeholder="00000"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={labelStyle}>País</label>
                                                        <select
                                                            value={form.domicilioContacto.pais}
                                                            onChange={e => setForm(prev => ({ ...prev, domicilioContacto: { ...prev.domicilioContacto, pais: e.target.value } }))}
                                                            className={selectStyle}
                                                        >
                                                            {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* CONTACTO & GESTIÓN */}
                                <div className="flex flex-col gap-10">
                                    {/* TELÉFONOS & EMAILS DINÁMICOS */}
                                    <div>
                                        <div className="grid grid-cols-2 gap-0 divide-x divider-corporate">
                                            {/* Teléfonos */}
                                            <div className="pr-8">
                                                <div className="app-section-header !justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <User size={14} className="text-sky-500 opacity-70" />
                                                        <h4 className="app-section-title">Teléfonos</h4>
                                                    </div>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 px-3 rounded-lg"
                                                        onClick={() => setForm(prev => ({ ...prev, telefonos: [...prev.telefonos, { label: `Teléfono ${prev.telefonos.length + 1}`, value: '' }] }))}
                                                    >
                                                        <Plus className="h-3.5 w-3.5 mr-1" />
                                                        Añadir
                                                    </Button>
                                                </div>
                                                <div className="space-y-2">
                                                    {form.telefonos.map((t, idx) => (
                                                        <div key={idx} className="grid grid-cols-[160px_1fr_auto] gap-2 items-center group">
                                                            <div className="relative">
                                                                <input
                                                                    value={t.label}
                                                                    onChange={e => setForm(prev => ({ ...prev, telefonos: prev.telefonos.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) }))}
                                                                    className="w-full text-xs font-normal text-[#4c739a] bg-white border border-[#cfdbe7] rounded px-2 h-8 focus:border-[#1380ec] outline-none transition-all placeholder:text-slate-300 pr-7"
                                                                    placeholder="Descripción (editable)"
                                                                />
                                                                <Pencil size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none opacity-50" />
                                                            </div>
                                                            <input
                                                                value={t.value}
                                                                onChange={e => setForm(prev => ({ ...prev, telefonos: prev.telefonos.map((x, i) => i === idx ? { ...x, value: e.target.value } : x) }))}
                                                                className="w-full text-xs font-normal text-[#4c739a] bg-white border border-[#cfdbe7] rounded px-2 h-8 focus:border-[#1380ec] outline-none transition-all placeholder:text-slate-300"
                                                                placeholder="Número"
                                                            />
                                                            {form.telefonos.length > 1 && (
                                                                <button
                                                                    onClick={() => setForm(prev => ({ ...prev, telefonos: prev.telefonos.filter((_, i) => i !== idx) }))}
                                                                    className="p-1.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Emails */}
                                            <div className="pl-8">
                                                <div className="app-section-header !justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <User size={14} className="text-sky-500 opacity-70" />
                                                        <h4 className="app-section-title">Emails</h4>
                                                    </div>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 px-3 rounded-lg"
                                                        onClick={() => setForm(prev => ({ ...prev, emails: [...prev.emails, { label: `Email ${prev.emails.length + 1}`, value: '' }] }))}
                                                    >
                                                        <Plus className="h-3.5 w-3.5 mr-1" />
                                                        Añadir
                                                    </Button>
                                                </div>
                                                <div className="space-y-2">
                                                    {form.emails.map((m, idx) => (
                                                        <div key={idx} className="grid grid-cols-[160px_1fr_auto] gap-2 items-center group">
                                                            <div className="relative">
                                                                <input
                                                                    value={m.label}
                                                                    onChange={e => setForm(prev => ({ ...prev, emails: prev.emails.map((x, i) => i === idx ? { ...x, label: e.target.value } : x) }))}
                                                                    className="w-full text-xs font-normal text-[#4c739a] bg-white border border-[#cfdbe7] rounded px-2 h-8 focus:border-[#1380ec] outline-none transition-all placeholder:text-slate-300 pr-7"
                                                                    placeholder="Descripción (editable)"
                                                                />
                                                                <Pencil size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none opacity-50" />
                                                            </div>
                                                            <input
                                                                value={m.value}
                                                                onChange={e => setForm(prev => ({ ...prev, emails: prev.emails.map((x, i) => i === idx ? { ...x, value: e.target.value } : x) }))}
                                                                className="w-full text-xs font-normal text-[#4c739a] bg-white border border-[#cfdbe7] rounded px-2 h-8 focus:border-[#1380ec] outline-none transition-all placeholder:text-slate-300"
                                                                placeholder="Email"
                                                            />
                                                            {form.emails.length > 1 && (
                                                                <button
                                                                    onClick={() => setForm(prev => ({ ...prev, emails: prev.emails.filter((_, i) => i !== idx) }))}
                                                                    className="p-1.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* GESTIÓN ADMINISTRATIVA */}
                                    <div>
                                        <div className="app-section-header">
                                            <Calendar size={14} className="text-sky-500 opacity-70" />
                                            <h4 className="app-section-title">Gestión</h4>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-[180px_180px_1fr] gap-4 items-end">
                                            <div>
                                                <label className={labelStyle}>Fecha Inicio</label>
                                                <input type="date" value={form.fechaInicio} onChange={e => updateForm('fechaInicio', e.target.value)} className={inputStyle} />
                                            </div>
                                            <div>
                                                <label className={labelStyle}>Cta. Contable</label>
                                                <input
                                                    value={form.cuentaContable}
                                                    onChange={e => updateForm('cuentaContable', e.target.value.replace(/\D/g, '').slice(0, 10))}
                                                    className={inputStyle}
                                                    placeholder="10 dígitos"
                                                    maxLength={10}
                                                    required={REQUIRE_CTA}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelStyle}>Forma de cobro</label>
                                                <div className="relative group">
                                                    <select
                                                        value={form.formaCobroId}
                                                        onChange={e => updateForm('formaCobroId', e.target.value)}
                                                        className={selectStyle}
                                                    >
                                                        <option value="">- Seleccione -</option>
                                                        {paymentMethods.filter(m => m.activo || m.id === form.formaCobroId).map(m => (
                                                            <option key={m.id} value={m.id}>{m.nombre}</option>
                                                        ))}
                                                    </select>
                                                    <ChevronRight className="w-4 h-4 text-slate-300 absolute right-1 top-1/2 -translate-y-1/2 rotate-90 pointer-events-none" />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-4">
                                            <label className={labelStyle}>Datos Contacto Importados CCS</label>
                                            <textarea
                                                value={form.datosContactoImportadosCCS}
                                                onChange={e => updateForm('datosContactoImportadosCCS', e.target.value)}
                                                className="w-full px-3 py-2 bg-white border-b border-[#cfdbe7] text-sm font-normal text-slate-800 focus:border-[#1380ec] outline-none transition-all placeholder:text-slate-300 min-h-[72px]"
                                                placeholder="Contenido bruto importado de CCS (columna Z)"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* DATOS BANCARIOS */}
                                <div>
                                    <div className="app-section-header">
                                        <Landmark size={14} className="text-sky-500 opacity-70" />
                                        <h4 className="app-section-title">Datos Bancarios</h4>
                                    </div>
                                    <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.02)] grid grid-cols-12 gap-5">
                                        <div className="col-span-12 md:col-span-3">
                                            <label className={labelStyle}>Banco Cobro</label>
                                            <input
                                                list="bancos-list"
                                                value={form.bancoCobro}
                                                onChange={e => {
                                                    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                                                    updateForm('bancoCobro', val);
                                                }}
                                                className={inputStyle}
                                                placeholder="0000"
                                                maxLength={4}
                                            />
                                            <datalist id="bancos-list">
                                                {BANCOS.map(b => (
                                                    <option key={b.code} value={b.code}>{b.name}</option>
                                                ))}
                                            </datalist>
                                            <div className="text-[9px] text-[#4c739a] mt-1 font-normal truncate">
                                                {BANCOS.find(b => b.code === form.bancoCobro)?.name}
                                            </div>
                                        </div>
                                        <div className="col-span-12 md:col-span-4">
                                            <label className={labelStyle}>Cuenta de Cobro</label>
                                            <input value={form.cuentaCobro} onChange={e => updateForm('cuentaCobro', e.target.value)} className={inputStyle} placeholder="0000 0000 00 0000000000" maxLength={24} />
                                        </div>
                                        <div className="col-span-12 md:col-span-5">
                                            <div className="flex items-center justify-between mb-1.5">
                                                <label className={labelStyle + " mb-0"}>IBAN</label>
                                                {form.iban && (
                                                    <CopyAction text={form.iban}>
                                                        <button className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-sky-600 hover:bg-sky-50 transition-all uppercase tracking-wider">
                                                            <Copy size={10} strokeWidth={3} />
                                                            Copiar
                                                        </button>
                                                    </CopyAction>
                                                )}
                                            </div>
                                            <input value={form.iban} onChange={e => updateForm('iban', e.target.value)} className={inputStyle} placeholder="ES00 0000..." />
                                        </div>
                                    </div>
                                </div>

                                {/* SECCIÓN DE OBSERVACIONES */}
                                <div className="space-y-6">
                                    <div className="app-section-header">
                                        <FileText size={14} className="text-sky-500 opacity-70" />
                                        <h4 className="app-section-title">Historial de Observaciones</h4>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_160px] gap-3 bg-[#f8fafc] p-4 rounded border border-[#e2e8f0] items-stretch">
                                        <div className="flex flex-col">
                                            <label className={labelStyle}>Fecha</label>
                                            <input
                                                type="date"
                                                value={obsFecha}
                                                onChange={(e) => setObsFecha(e.target.value)}
                                                className="w-full h-10 px-3 bg-white border border-[#cfdbe7] text-xs font-normal text-[#4c739a] focus:border-[#1380ec] outline-none transition-all rounded"
                                            />
                                        </div>

                                        <div className="flex flex-col">
                                            <label className={labelStyle}>Descripción de la observación</label>
                                            <textarea
                                                ref={obsTextRef}
                                                value={obsDescripcion}
                                                onChange={handleObsTextChange}
                                                placeholder="Escriba aquí la nota o aviso..."
                                                className="w-full px-3 py-2 bg-white border border-[#cfdbe7] text-xs font-normal text-[#4c739a] focus:border-[#1380ec] outline-none transition-all resize-none rounded overflow-hidden leading-5"
                                                style={{ minHeight: '40px' }}
                                            />
                                        </div>

                                        <div className="flex flex-col">
                                            <label className="text-[10px] font-normal text-transparent uppercase select-none mb-1 block">.</label>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="h-10 px-4 rounded-xl w-full"
                                                onClick={handleAddObservation}
                                            >
                                                <Plus className="h-4 w-4 mr-2" />
                                                Añadir
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="border border-[#e2e8f0] rounded overflow-hidden shadow-sm">
                                        {/* Cabecera Tabla */}
                                        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 bg-[#f1f5f9] p-3 text-[10px] font-medium uppercase tracking-widest text-[#4c739a]">
                                            <button
                                                type="button"
                                                className="flex items-center gap-1 whitespace-nowrap px-2 hover:text-[#1380ec] transition-colors"
                                                onClick={() => setObsSortDir(d => (d === "asc" ? "desc" : "asc"))}
                                            >
                                                Fecha <span className="text-[10px]">{obsSortDir === "asc" ? "▲" : "▼"}</span>
                                            </button>

                                            <div className="px-2">Descripción</div>

                                            <div className="whitespace-nowrap px-4 text-center">Acciones</div>
                                        </div>

                                        {/* Filas */}
                                        <div className="divide-y divide-[#f1f5f9] max-h-80 overflow-y-auto scrollbar-thin bg-white">
                                            {sortedObservaciones.length === 0 ? (
                                                <div className="p-8 text-xs font-medium text-slate-400 text-center italic">
                                                    No hay observaciones registradas en la ficha del cliente.
                                                </div>
                                            ) : (
                                                sortedObservaciones.map((o, idx) => (
                                                    <div
                                                        key={`${o.fecha}-${idx}`}
                                                        className="grid grid-cols-[auto_1fr_auto] items-start gap-2 p-3 text-xs group hover:bg-slate-50 transition-colors"
                                                    >
                                                        {/* Fecha: ancho mínimo */}
                                                        <div
                                                            className="whitespace-nowrap px-2 font-medium text-[#4c739a] pt-1"
                                                            style={{ fontVariantNumeric: "tabular-nums" }}
                                                        >
                                                            {new Date(o.fecha).toLocaleDateString('es-ES')}
                                                        </div>

                                                        {/* Descripción: ocupa todo */}
                                                        <div className="font-medium text-slate-700 whitespace-pre-wrap leading-relaxed px-2 pt-1">
                                                            {o.descripcion}
                                                        </div>

                                                        {/* Acciones: mínimo */}
                                                        <div className="whitespace-nowrap px-4 flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopyObservation(o, idx)}
                                                                className="text-slate-400 hover:text-blue-600 transition-colors p-1.5 rounded hover:bg-blue-50"
                                                                title="Copiar al portapapeles"
                                                            >
                                                                {copiedIdx === idx ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRemoveObservation(idx)}
                                                                className="text-slate-400 hover:text-red-500 transition-colors p-1.5 rounded hover:bg-red-50"
                                                                title="Eliminar observación"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>
                    ) : activeTab === 'otros' ? (
                        <div className="animate-in slide-in-from-bottom-2 duration-300">
                            <div className="space-y-10">
                                {form.tipo === 'PARTICULAR' ? (
                                    <div>
                                        <div className="app-section-header">
                                            <Calendar size={14} className="text-sky-500 opacity-70" />
                                            <h4 className="app-section-title">Datos Personales</h4>
                                        </div>
                                        <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.02)] grid grid-cols-1 md:grid-cols-3 gap-6">
                                            <div>
                                                <label className={labelStyle}>Fecha de Nacimiento</label>
                                                <input
                                                    type="date"
                                                    value={form.birthDate}
                                                    onChange={e => updateForm('birthDate', e.target.value)}
                                                    className={inputStyle}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* Escritura de constitución */}
                                        <div className="animate-in fade-in slide-in-from-top-2 duration-500">
                                            <div className="app-section-header">
                                                <Landmark size={14} className="text-sky-500 opacity-70" />
                                                <h4 className="app-section-title">Escritura de constitución</h4>
                                            </div>
                                            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-6">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                    <div>
                                                        <label className={labelStyle}>Notaría</label>
                                                        <input
                                                            value={form.notaria}
                                                            onChange={e => updateForm('notaria', e.target.value)}
                                                            className={inputStyle}
                                                            placeholder="Nombre de la notaría"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={labelStyle}>Notario/a</label>
                                                        <input
                                                            value={form.notario}
                                                            onChange={e => updateForm('notario', e.target.value)}
                                                            className={inputStyle}
                                                            placeholder="Nombre completo del notario"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-[200px_200px] gap-6">
                                                    <div>
                                                        <label className={labelStyle}>Fecha de escritura</label>
                                                        <input
                                                            type="date"
                                                            value={form.fechaEscritura}
                                                            onChange={e => updateForm('fechaEscritura', e.target.value)}
                                                            className={inputStyle}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={labelStyle}>Nº de protocolo</label>
                                                        <input
                                                            value={form.numeroProtocolo}
                                                            onChange={e => updateForm('numeroProtocolo', e.target.value)}
                                                            className={inputStyle}
                                                            placeholder="Número de protocolo"
                                                        />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className={labelStyle}>Observaciones / detalle</label>
                                                    <textarea
                                                        value={form.observacionesEscritura}
                                                        onChange={e => updateForm('observacionesEscritura', e.target.value)}
                                                        className="w-full px-3 py-2 bg-white border-b border-[#cfdbe7] text-sm font-normal text-slate-800 focus:border-[#1380ec] outline-none transition-all placeholder:text-slate-300 min-h-[80px]"
                                                        placeholder="Detalles adicionales de la escritura..."
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Datos registrales */}
                                        <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                                            <div className="app-section-header">
                                                <FileText size={14} className="text-sky-500 opacity-70" />
                                                <h4 className="app-section-title">Datos registrales</h4>
                                            </div>
                                            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-6">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                    <div>
                                                        <label className={labelStyle}>Registro</label>
                                                        <input
                                                            value={form.registroMercantil}
                                                            onChange={e => updateForm('registroMercantil', e.target.value)}
                                                            className={inputStyle}
                                                            placeholder="Registro Mercantil de..."
                                                        />
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-3">
                                                        <div>
                                                            <label className={labelStyle}>Tomo</label>
                                                            <input value={form.tomo} onChange={e => updateForm('tomo', e.target.value)} className={inputStyle} />
                                                        </div>
                                                        <div>
                                                            <label className={labelStyle}>Libro</label>
                                                            <input value={form.libro} onChange={e => updateForm('libro', e.target.value)} className={inputStyle} />
                                                        </div>
                                                        <div>
                                                            <label className={labelStyle}>Folio</label>
                                                            <input value={form.folio} onChange={e => updateForm('folio', e.target.value)} className={inputStyle} />
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                                    <div>
                                                        <label className={labelStyle}>Hoja</label>
                                                        <input value={form.hoja} onChange={e => updateForm('hoja', e.target.value)} className={inputStyle} />
                                                    </div>
                                                    <div>
                                                        <label className={labelStyle}>Sección</label>
                                                        <input value={form.seccion} onChange={e => updateForm('seccion', e.target.value)} className={inputStyle} />
                                                    </div>
                                                    <div>
                                                        <label className={labelStyle}>Inscripción</label>
                                                        <input value={form.inscripcion} onChange={e => updateForm('inscripcion', e.target.value)} className={inputStyle} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className={labelStyle}>Observaciones</label>
                                                    <textarea
                                                        value={form.observacionesRegistro}
                                                        onChange={e => updateForm('observacionesRegistro', e.target.value)}
                                                        className="w-full px-3 py-2 bg-white border-b border-[#cfdbe7] text-sm font-normal text-slate-800 focus:border-[#1380ec] outline-none transition-all placeholder:text-slate-300 min-h-[80px]"
                                                        placeholder="Detalles adicionales del registro..."
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="animate-in slide-in-from-bottom-2 duration-300">
                            <div className="space-y-8">
                                <div className="app-section-header !justify-between">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck size={14} className="text-sky-500 opacity-70" />
                                        <h4 className="app-section-title">Administradores / Representantes</h4>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 px-4 rounded-xl border-slate-200 hover:border-sky-500 hover:text-sky-600 transition-all font-bold text-[10px] uppercase tracking-widest"
                                        onClick={() => {
                                            const newId = `adm_${Date.now()}`;
                                            setForm(prev => ({
                                                ...prev,
                                                administrators: [
                                                    ...prev.administrators,
                                                    {
                                                        id: newId,
                                                        nombre: '',
                                                        nif: '',
                                                        position: 'Administrador',
                                                        telefonos: [{ value: '', label: 'Teléfono 1' }],
                                                        emails: [{ value: '', label: 'Email Principal' }],
                                                        domicilioFiscal: { sigla: 'CL', pais: 'ESPAÑA', provincia: '', poblacion: '', via: '', cp: '' },
                                                        domicilioContacto: { sigla: 'CL', pais: 'ESPAÑA', provincia: '', poblacion: '', via: '', cp: '' },
                                                        domicilioContactoIgualFiscal: true
                                                    }
                                                ]
                                            }));
                                            setEditingAdminId(newId);
                                        }}
                                    >
                                        <Plus className="h-3.5 w-3.5 mr-1" />
                                        Añadir Administrador
                                    </Button>
                                </div>

                                {form.administrators.length === 0 ? (
                                    <div className="text-center py-20 bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-100 animate-in fade-in duration-500">
                                        <Users className="w-10 h-10 text-slate-200 mx-auto mb-4" />
                                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">No hay administradores registrados</p>
                                        <p className="text-[10px] text-slate-300 mt-2">Los administradores son necesarios para expedientes de personas jurídicas</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {form.administrators.map((admin, _idx) => {
                                            const isEditing = editingAdminId === admin.id;
                                            return (
                                                <div key={admin.id} className={`bg-white border transition-all duration-300 ${isEditing ? 'border-sky-300 shadow-xl ring-1 ring-sky-100 rounded-[32px]' : 'border-slate-100 hover:border-slate-300 shadow-sm rounded-2xl'}`}>
                                                    {/* Admin Header Row */}
                                                    <div className={`p-5 flex items-center justify-between cursor-pointer ${isEditing ? 'bg-sky-50/30 rounded-t-[32px] border-b border-sky-100' : ''}`} onClick={() => setEditingAdminId(isEditing ? null : admin.id)}>
                                                        <div className="flex items-center gap-5">
                                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold transition-all duration-500 ${isEditing ? 'bg-sky-500 text-white shadow-lg shadow-sky-200 rotate-3' : 'bg-slate-50 text-slate-400'}`}>
                                                                {(admin.nombre || '').charAt(0) || '?'}
                                                            </div>
                                                            <div>
                                                                <h5 className="text-[15px] font-bold text-slate-700 flex items-center gap-3">
                                                                    {(admin.nombre || '').toUpperCase() || 'NUEVO ADMINISTRADOR'}
                                                                    {admin.nif && <span className="text-sky-500 font-mono text-xs bg-sky-50 px-2 py-0.5 rounded-full border border-sky-100">{admin.nif}</span>}
                                                                </h5>
                                                                <div className="flex items-center gap-2 mt-0.5">
                                                                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">{admin.position || 'Administrador'}</p>
                                                                    {isEditing && <span className="w-1 h-1 rounded-full bg-sky-400 animate-pulse"></span>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setForm(prev => ({ ...prev, administrators: prev.administrators.filter(a => a.id !== admin.id) }));
                                                                    if (isEditing) setEditingAdminId(null);
                                                                }}
                                                                className="p-2.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                                                title="Eliminar administrador"
                                                            >
                                                                <Trash2 size={18} />
                                                            </button>
                                                            <div className={`p-2.5 rounded-xl transition-all ${isEditing ? 'bg-sky-100 text-sky-600' : 'text-slate-300 group-hover:text-slate-400'}`}>
                                                                <ChevronRight size={20} className={`transition-transform duration-500 ${isEditing ? 'rotate-90' : ''}`} />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Detail Form (Expanded) */}
                                                    {isEditing && (
                                                        <div className="p-8 space-y-12 animate-in fade-in slide-in-from-top-4 duration-500">
                                                            {/* BLOQUE: Datos Identificativos */}
                                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                                                <div className="md:col-span-1">
                                                                    <IdentifierField
                                                                        value={admin.nif}
                                                                        onChange={(val) => updateAdmin(admin.id, { nif: val })}
                                                                        onAutofill={(client) => {
                                                                            // Autofill administrator details from client
                                                                            updateAdmin(admin.id, {
                                                                                nombre: client.nombre,
                                                                                telefonos: client.telefonos || (client.telefono ? [{ label: 'Teléfono', value: client.telefono }] : []),
                                                                                emails: client.emails || (client.email ? [{ label: 'Email', value: client.email }] : []),
                                                                                domicilioFiscal: client.domicilioFiscal || {
                                                                                    sigla: 'CL',
                                                                                    via: client.address || '',
                                                                                    poblacion: client.city || '',
                                                                                    provincia: client.province || '',
                                                                                    cp: client.postalCode || '',
                                                                                    pais: 'ESPAÑA'
                                                                                }
                                                                            });
                                                                        }}
                                                                        onSelectDuplicate={onSelectClient}
                                                                        label="Identificador"
                                                                        inputClassName={inputStyle}
                                                                        labelClassName={labelStyle}
                                                                    />
                                                                </div>
                                                                <div className="md:col-span-2 space-y-1.5">
                                                                    <label className={labelStyle}>Apellidos, Nombre</label>
                                                                    <input
                                                                        value={admin.nombre}
                                                                        onChange={e => updateAdmin(admin.id, { nombre: e.target.value })}
                                                                        className={inputStyle}
                                                                        placeholder="APELLIDOS, NOMBRE"
                                                                    />
                                                                </div>
                                                                <div className="md:col-span-1 space-y-1.5">
                                                                    <label className={labelStyle}>Cargo / Título</label>
                                                                    <input
                                                                        value={admin.position}
                                                                        onChange={e => updateAdmin(admin.id, { position: e.target.value })}
                                                                        className={inputStyle}
                                                                        placeholder="Ej: Administrador Único"
                                                                    />
                                                                </div>
                                                            </div>

                                                            {/* BLOQUE: Contacto y Gestión */}
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 border-t border-slate-50 pt-10">
                                                                {/* Teléfonos Administrador */}
                                                                <div className="space-y-5">
                                                                    <div className="app-section-header !justify-between">
                                                                        <div className="flex items-center gap-2">
                                                                            <User size={14} className="text-sky-500 opacity-70" />
                                                                            <h4 className="app-section-title">Teléfonos</h4>
                                                                        </div>
                                                                        <Button variant="outline" size="sm" className="h-8 rounded-lg text-[9px] font-bold" onClick={() => updateAdmin(admin.id, { telefonos: [...(admin.telefonos || []), { label: `Teléfono ${(admin.telefonos?.length || 0) + 1}`, value: '' }] })}>
                                                                            <Plus size={14} className="mr-1" /> Añadir
                                                                        </Button>
                                                                    </div>
                                                                    <div className="space-y-3">
                                                                        {(admin.telefonos || []).map((t: ContactItem, tIdx: number) => (
                                                                            <div key={tIdx} className="grid grid-cols-[140px_1fr_auto] gap-2 items-center group">
                                                                                <div className="relative">
                                                                                    <input value={t.label} onChange={e => updateAdmin(admin.id, { telefonos: admin.telefonos?.map((x: ContactItem, i: number) => i === tIdx ? { ...x, label: e.target.value } : x) })} className="w-full text-xs font-normal text-[#4c739a] bg-white border border-slate-200 rounded-lg px-3 h-10 focus:border-sky-500 outline-none transition-all pr-8" placeholder="Etiqueta" />
                                                                                    <Pencil size={10} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                                </div>
                                                                                <input value={t.value} onChange={e => updateAdmin(admin.id, { telefonos: admin.telefonos?.map((x: ContactItem, i: number) => i === tIdx ? { ...x, value: e.target.value } : x) })} className="w-full text-xs font-normal text-[#4c739a] bg-white border border-slate-200 rounded-lg px-3 h-10 focus:border-sky-500 outline-none transition-all" placeholder="Número" />
                                                                                <button onClick={() => updateAdmin(admin.id, { telefonos: admin.telefonos?.filter((_: ContactItem, i: number) => i !== tIdx) })} className="p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-50 rounded-lg">
                                                                                    <X size={16} />
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>

                                                                {/* Emails Administrador */}
                                                                <div className="space-y-5">
                                                                    <div className="app-section-header !justify-between">
                                                                        <div className="flex items-center gap-2">
                                                                            <User size={14} className="text-sky-500 opacity-70" />
                                                                            <h4 className="app-section-title">Emails</h4>
                                                                        </div>
                                                                        <Button variant="outline" size="sm" className="h-8 rounded-lg text-[9px] font-bold" onClick={() => updateAdmin(admin.id, { emails: [...(admin.emails || []), { label: `Email ${(admin.emails?.length || 0) + 1}`, value: '' }] })}>
                                                                            <Plus size={14} className="mr-1" /> Añadir
                                                                        </Button>
                                                                    </div>
                                                                    <div className="space-y-3">
                                                                        {(admin.emails || []).map((m: ContactItem, mIdx: number) => (
                                                                            <div key={mIdx} className="grid grid-cols-[140px_1fr_auto] gap-2 items-center group">
                                                                                <div className="relative">
                                                                                    <input value={m.label} onChange={e => updateAdmin(admin.id, { emails: admin.emails?.map((x: ContactItem, i: number) => i === mIdx ? { ...x, label: e.target.value } : x) })} className="w-full text-xs font-normal text-[#4c739a] bg-white border border-slate-200 rounded-lg px-3 h-10 focus:border-sky-500 outline-none transition-all pr-8" placeholder="Etiqueta" />
                                                                                    <Pencil size={10} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                                </div>
                                                                                <input value={m.value} onChange={e => updateAdmin(admin.id, { emails: admin.emails?.map((x: ContactItem, i: number) => i === mIdx ? { ...x, value: e.target.value } : x) })} className="w-full text-xs font-normal text-[#4c739a] bg-white border border-slate-200 rounded-lg px-3 h-10 focus:border-sky-500 outline-none transition-all" placeholder="Email" />
                                                                                <button onClick={() => updateAdmin(admin.id, { emails: admin.emails?.filter((_: ContactItem, i: number) => i !== mIdx) })} className="p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-50 rounded-lg">
                                                                                    <X size={16} />
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* BLOQUE: Domicilios */}
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 border-t border-slate-50 pt-10">
                                                                {/* Domicilio Fiscal */}
                                                                <div className="space-y-5">
                                                                    <div className="app-section-header !justify-between">
                                                                        <div className="flex items-center gap-2">
                                                                            <MapPin size={14} className="text-sky-500 opacity-70" />
                                                                            <h4 className="app-section-title">Domicilio Fiscal</h4>
                                                                        </div>
                                                                        <button
                                                                            onClick={() => updateAdmin(admin.id, { domicilioFiscal: { ...form.domicilioFiscal } })}
                                                                            className="text-[9px] font-bold text-sky-600 hover:text-sky-700 uppercase tracking-widest bg-sky-50 px-3 py-1.5 rounded-xl border border-sky-100 transition-all active:scale-95"
                                                                        >
                                                                            Copiar de Cliente
                                                                        </button>
                                                                    </div>
                                                                    <div className="p-6 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-6">
                                                                        <div className="grid grid-cols-12 gap-4">
                                                                            <div className="col-span-3">
                                                                                <label className={labelStyle}>Sigla</label>
                                                                                <select value={admin.domicilioFiscal?.sigla} onChange={e => updateAdmin(admin.id, { domicilioFiscal: { ...admin.domicilioFiscal!, sigla: e.target.value } })} className={selectStyle}>
                                                                                    {SIGLAS.map(s => <option key={s} value={s}>{s}</option>)}
                                                                                </select>
                                                                            </div>
                                                                            <div className="col-span-9">
                                                                                <label className={labelStyle}>Vía Pública</label>
                                                                                <input value={admin.domicilioFiscal?.via} onChange={e => updateAdmin(admin.id, { domicilioFiscal: { ...admin.domicilioFiscal!, via: e.target.value } })} className={inputStyle} placeholder="Calle, etc." />
                                                                            </div>
                                                                        </div>
                                                                        <div className="grid grid-cols-2 gap-4">
                                                                            <div>
                                                                                <label className={labelStyle}>C.P.</label>
                                                                                <input value={admin.domicilioFiscal?.cp} onChange={e => updateAdmin(admin.id, { domicilioFiscal: { ...admin.domicilioFiscal!, cp: e.target.value } })} className={inputStyle} placeholder="00000" />
                                                                            </div>
                                                                            <div>
                                                                                <label className={labelStyle}>Población</label>
                                                                                <input value={admin.domicilioFiscal?.poblacion} onChange={e => updateAdmin(admin.id, { domicilioFiscal: { ...admin.domicilioFiscal!, poblacion: e.target.value } })} className={inputStyle} placeholder="Localidad" />
                                                                            </div>
                                                                        </div>
                                                                        <div className="grid grid-cols-2 gap-4">
                                                                            <div>
                                                                                <label className={labelStyle}>Provincia</label>
                                                                                <select value={admin.domicilioFiscal?.provincia} onChange={e => updateAdmin(admin.id, { domicilioFiscal: { ...admin.domicilioFiscal!, provincia: e.target.value } })} className={selectStyle}>
                                                                                    <option value="">- Selecc -</option>
                                                                                    {PROVINCIAS_ES.map(p => <option key={p} value={p}>{p}</option>)}
                                                                                </select>
                                                                            </div>
                                                                            <div>
                                                                                <label className={labelStyle}>País</label>
                                                                                <select value={admin.domicilioFiscal?.pais} onChange={e => updateAdmin(admin.id, { domicilioFiscal: { ...admin.domicilioFiscal!, pais: e.target.value } })} className={selectStyle}>
                                                                                    {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
                                                                                </select>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Domicilio Contacto */}
                                                                <div className="space-y-5">
                                                                    <div className="app-section-header !justify-between">
                                                                        <div className="flex items-center gap-2">
                                                                            <MapPin size={14} className="text-sky-500 opacity-70" />
                                                                            <h4 className="app-section-title">Domicilio Contacto</h4>
                                                                        </div>
                                                                        <label className="flex items-center gap-2 cursor-pointer group">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={admin.domicilioContactoIgualFiscal}
                                                                                onChange={e => updateAdmin(admin.id, { domicilioContactoIgualFiscal: e.target.checked })}
                                                                                className="w-4 h-4 rounded border-slate-200 text-sky-600 focus:ring-sky-500 transition-all cursor-pointer"
                                                                            />
                                                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest group-hover:text-sky-600 transition-colors">Igual Fiscal</span>
                                                                        </label>
                                                                    </div>
                                                                    {!admin.domicilioContactoIgualFiscal ? (
                                                                        <div className="p-6 bg-sky-50/20 rounded-3xl border border-sky-100 space-y-6 animate-in fade-in duration-500">
                                                                            <div className="grid grid-cols-12 gap-4">
                                                                                <div className="col-span-3">
                                                                                    <label className={labelStyle}>Sigla</label>
                                                                                    <select value={admin.domicilioContacto?.sigla} onChange={e => updateAdmin(admin.id, { domicilioContacto: { ...admin.domicilioContacto!, sigla: e.target.value } })} className={selectStyle}>
                                                                                        {SIGLAS.map(s => <option key={s} value={s}>{s}</option>)}
                                                                                    </select>
                                                                                </div>
                                                                                <div className="col-span-9">
                                                                                    <label className={labelStyle}>Vía Pública</label>
                                                                                    <input value={admin.domicilioContacto?.via} onChange={e => updateAdmin(admin.id, { domicilioContacto: { ...admin.domicilioContacto!, via: e.target.value } })} className={inputStyle} placeholder="Calle, etc." />
                                                                                </div>
                                                                            </div>
                                                                            <div className="grid grid-cols-2 gap-4">
                                                                                <div>
                                                                                    <label className={labelStyle}>C.P.</label>
                                                                                    <input value={admin.domicilioContacto?.cp} onChange={e => updateAdmin(admin.id, { domicilioContacto: { ...admin.domicilioContacto!, cp: e.target.value } })} className={inputStyle} placeholder="00000" />
                                                                                </div>
                                                                                <div>
                                                                                    <label className={labelStyle}>Población</label>
                                                                                    <input value={admin.domicilioContacto?.poblacion} onChange={e => updateAdmin(admin.id, { domicilioContacto: { ...admin.domicilioContacto!, poblacion: e.target.value } })} className={inputStyle} placeholder="Localidad" />
                                                                                </div>
                                                                            </div>
                                                                            <div className="grid grid-cols-2 gap-4">
                                                                                <div>
                                                                                    <label className={labelStyle}>Provincia</label>
                                                                                    <select value={admin.domicilioContacto?.provincia} onChange={e => updateAdmin(admin.id, { domicilioContacto: { ...admin.domicilioContacto!, provincia: e.target.value } })} className={selectStyle}>
                                                                                        <option value="">- Selecc -</option>
                                                                                        {PROVINCIAS_ES.map(p => <option key={p} value={p}>{p}</option>)}
                                                                                    </select>
                                                                                </div>
                                                                                <div>
                                                                                    <label className={labelStyle}>País</label>
                                                                                    <select value={admin.domicilioContacto?.pais} onChange={e => updateAdmin(admin.id, { domicilioContacto: { ...admin.domicilioContacto!, pais: e.target.value } })} className={selectStyle}>
                                                                                        {PAISES.map(p => <option key={p} value={p}>{p}</option>)}
                                                                                    </select>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="py-16 border-2 border-dashed border-slate-100 rounded-3xl flex flex-col items-center justify-center text-slate-300 bg-slate-50/20">
                                                                            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-sm border border-slate-50 mb-3 text-sky-500">
                                                                                <Check size={24} />
                                                                            </div>
                                                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Vinculado a dirección fiscal</p>
                                                                            <p className="text-[9px] text-slate-300 mt-1 uppercase">Cambios en fiscal se reflejarán aquí</p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="bg-white border-t border-slate-100 px-8 py-5 flex justify-between items-center shrink-0">
                    <p className="app-muted !text-[9px] !uppercase">
                        {clientId ? `EDITANDO CLIENTE: ${clientId.slice(0, 8)}...` : 'NUEVO REGISTRO'}
                    </p>
                </div>

                {/* 5. CONFIRMATION MODAL */}
                <ConfirmationModal
                    isOpen={showConfirmSame}
                    onClose={() => setShowConfirmSame(false)}
                    onConfirm={() => {
                        setForm(prev => ({
                            ...prev,
                            domicilioContactoIgualFiscal: true,
                            domicilioContacto: {}
                        }));
                        setShowConfirmSame(false);
                    }}
                    title="¿Confirmar cambio de domicilio?"
                    message="Ya existe un domicilio de contacto diferente. Si marcas 'Igual que Fiscal' se descartarán los datos actuales de contacto. ¿Deseas continuar?"
                />

                <ConfirmationModal
                    isOpen={showConfirmClose}
                    title="Cambios sin guardar"
                    message="Has realizado cambios en la ficha del cliente. ¿Deseas guardarlos antes de salir para no perder la información?"
                    confirmText="Guardar y salir"
                    cancelText="Seguir editando"
                    secondaryText="Salir sin guardar"
                    secondaryAction={() => {
                        setShowConfirmClose(false);
                        onClose();
                    }}
                    variant="info"
                    onClose={() => setShowConfirmClose(false)}
                    onConfirm={async () => {
                        await save();
                        onClose();
                    }}
                />

                <ConfirmationModal
                    isOpen={obsToDeleteIdx !== null}
                    onClose={() => setObsToDeleteIdx(null)}
                    onConfirm={confirmDeleteObservation}
                    title="Eliminar observación"
                    message="¿Estás seguro de que deseas eliminar esta observación? Esta acción no se puede deshacer."
                    confirmText="Eliminar"
                    cancelText="Cancelar"
                    variant="danger"
                />

                <ConfirmationModal
                    isOpen={showConfirmVerify}
                    onClose={() => setShowConfirmVerify(false)}
                    onConfirm={confirmVerification}
                    title="¿Confirmas verificación?"
                    message={'Se marcará este cliente como verificado y se guardará el usuario activo en el campo "verificado por".'}
                    confirmText="Confirmar"
                    cancelText="Cancelar"
                    variant="info"
                />
            </div>
        </div>
    );
};

export default ClientDetailModal;
