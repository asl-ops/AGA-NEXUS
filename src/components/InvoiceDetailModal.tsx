import React, { useState } from 'react';
import { Trash2, Send, Lock, Ban, Banknote, ShieldCheck, RefreshCcw, Calendar, Copy } from 'lucide-react';
import { HeaderActions } from './ui/HeaderActions';
import { pdf } from '@react-pdf/renderer';
import { Invoice, InvoiceStatus } from '../types/billing';
import { useInvoices } from '../hooks/useInvoices';
import { useCompanySettings } from '../hooks/useCompanySettings';
import InvoicePDFDocument from './InvoicePDFDocument';
import { useConfirmation, confirmVoid, confirmDelete } from '@/hooks/useConfirmation';
import ConfirmationModal from './ConfirmationModal';
import { CopyAction } from './ui/ActionFeedback';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    invoice: Invoice;
    onUpdate: () => void;
}

const statusLabels: Record<InvoiceStatus, { label: string; color: string }> = {
    draft: { label: 'Borrador', color: 'bg-slate-100 text-slate-600' },
    issued: { label: 'Emitida', color: 'bg-emerald-100 text-emerald-600' },
    void: { label: 'Anulada', color: 'bg-slate-200 text-slate-500' }
};

const InvoiceDetailModal: React.FC<Props> = ({ isOpen, onClose, invoice, onUpdate }) => {
    const { issueInvoice, voidInvoice, deleteInvoice, markAsPaid, markAsUnpaid, loading } = useInvoices();
    const { company } = useCompanySettings();
    const [updating, setUpdating] = useState(false);
    const [generatingPdf, setGeneratingPdf] = useState(false);

    // Confirmation modal
    const { confirmationState, confirm, closeConfirmation } = useConfirmation();

    const emitHelpError = (error: string) => {
        window.dispatchEvent(new CustomEvent('aga:help-error', { detail: { error } }));
    };

    if (!isOpen) return null;

    const handleIssue = async () => {
        if (!invoice.clientId && !invoice.clientName && !invoice.clientIdentity) {
            emitHelpError('INVOICE_CREATE_WITHOUT_CLIENT');
            return;
        }
        const confirmed = await confirm({
            title: '¿Emitir factura?',
            message: 'Se asignará un número oficial a esta factura.',
            description: 'Una vez emitida, la factura no podrá editarse. Solo podrás anularla o marcarla como pagada.',
            confirmText: 'Emitir Factura',
            variant: 'info'
        });

        if (!confirmed) return;

        setUpdating(true);
        const result = await issueInvoice(invoice.id);
        setUpdating(false);
        if (result.success) {
            onUpdate();
        }
    };

    const handleVoid = async () => {
        const confirmed = await confirm({
            ...confirmVoid('factura'),
            message: `La factura ${invoice.number} será anulada.`,
            description: 'La factura perderá su validez legal. Esta acción no se puede deshacer.'
        });

        if (!confirmed) return;

        setUpdating(true);
        await voidInvoice(invoice.id);
        setUpdating(false);
        onUpdate();
    };

    const handleDelete = async () => {
        if (invoice.status !== 'draft') {
            handleVoid();
            return;
        }

        const confirmed = await confirm({
            ...confirmDelete('factura'),
            message: 'La factura borrador será eliminada permanentemente.',
            description: 'Esta acción no se puede deshacer. El borrador será eliminado de la base de datos.'
        });

        if (!confirmed) return;

        setUpdating(true);
        await deleteInvoice(invoice.id);
        setUpdating(false);
        onUpdate();
    };

    const handleDownloadPdf = async () => {
        setGeneratingPdf(true);
        try {
            const blob = await pdf(<InvoicePDFDocument invoice={invoice} company={company} />).toBlob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `factura-${invoice.number || invoice.id.slice(0, 8)}.pdf`;
            link.click();
            URL.revokeObjectURL(url);
        } finally {
            setGeneratingPdf(false);
        }
    };

    const statusInfo = statusLabels[invoice.status];
    const isLocked = invoice.status !== 'draft';

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden font-sans border border-white/20">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-emerald-50/30">
                    <div>
                        <div className="flex items-center gap-3">
                            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                                {invoice.number ? `Factura ${invoice.number}` : 'Factura (Borrador)'}
                            </h3>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusInfo.color}`}>
                                {statusInfo.label}
                            </span>
                            {invoice.status === 'issued' && (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${invoice.isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                    {invoice.isPaid ? 'Pagada' : 'Pendiente'}
                                </span>
                            )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-1">{invoice.id}</div>
                    </div>
                    <HeaderActions
                        onPrint={handleDownloadPdf}
                        onPrimary={
                            invoice.status === 'draft' ? handleIssue :
                                invoice.status === 'issued' && !invoice.isPaid ? async () => { setUpdating(true); await markAsPaid(invoice.id); setUpdating(false); onUpdate(); } :
                                    invoice.status === 'issued' && invoice.isPaid ? async () => {
                                        const confirmed = await confirm({
                                            title: '¿Desmarcar pago?',
                                            message: 'La factura será marcada como pendiente de pago.',
                                            description: 'Podrás volver a marcarla como pagada más tarde si es necesario.',
                                            confirmText: 'Desmarcar Pago',
                                            variant: 'warning'
                                        });
                                        if (!confirmed) return;
                                        setUpdating(true);
                                        await markAsUnpaid(invoice.id);
                                        setUpdating(false);
                                        onUpdate();
                                    } :
                                        () => { }
                        }
                        primaryIcon={
                            invoice.status === 'draft' ? Send :
                                invoice.status === 'issued' && !invoice.isPaid ? Banknote :
                                    invoice.status === 'issued' && invoice.isPaid ? RefreshCcw : // Desmarcar
                                        ShieldCheck
                        }
                        primaryTooltip={
                            invoice.status === 'draft' ? 'Emitir Factura' :
                                invoice.status === 'issued' && !invoice.isPaid ? 'Marcar Pagada' :
                                    invoice.status === 'issued' && invoice.isPaid ? 'Desmarcar Pago' :
                                        'Factura'
                        }
                        isPrimaryLoading={updating || loading || generatingPdf}
                        onClose={onClose}
                    />
                </div>

                {/* Body */}
                <div className="p-8 max-h-[70vh] overflow-y-auto">
                    {/* Locked Banner */}
                    {isLocked && (
                        <div className="mb-6 px-4 py-3 bg-sky-50 border border-sky-100 rounded-lg flex items-center gap-3">
                            <Lock size={16} className="text-sky-500 shrink-0" />
                            <div>
                                <span className="text-sm text-sky-700">Factura emitida: edición bloqueada</span>
                                {invoice.status === 'void' && (
                                    <span className="text-xs text-slate-500 block mt-0.5">Esta factura ha sido anulada</span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Header Info */}
                    <div className="grid grid-cols-2 gap-8 mb-8">
                        <div>
                            <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Cliente</span>
                            {invoice.clientName ? (
                                <>
                                    <div className="font-semibold text-slate-900 text-lg">{invoice.clientName}</div>
                                    <div className="text-xs text-slate-500 font-mono mt-1">
                                        {invoice.clientIdentity ? (
                                            <CopyAction text={invoice.clientIdentity}>
                                                <div className="inline-flex items-center gap-1 group/copy">
                                                    <span>{invoice.clientIdentity}</span>
                                                    <Copy size={11} className="text-slate-300 group-hover/copy:text-sky-500" />
                                                </div>
                                            </CopyAction>
                                        ) : (
                                            'Sin documento'
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="text-slate-400 italic">Sin cliente asignado</div>
                            )}
                        </div>
                        <div className="text-right">
                            <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Expediente</span>
                            {invoice.expedienteNumero ? (
                                <div className="font-semibold text-indigo-600 text-lg">{invoice.expedienteNumero}</div>
                            ) : (
                                <div className="text-slate-400 italic">Sin expediente</div>
                            )}
                            <div className="text-xs text-slate-500 font-mono mt-1 flex items-center justify-end gap-1">
                                <Calendar size={12} />
                                {new Date(invoice.issuedAt || invoice.createdAt).toLocaleDateString()}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8 mb-8 border-t border-slate-50 pt-4">
                        <div>
                            <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Forma de Cobro</span>
                            <div className="flex items-center gap-2 text-slate-600">
                                <Banknote size={14} className="text-slate-400" />
                                <span className="text-sm font-medium">{invoice.paymentMethod || 'No especificada'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Lines Table */}
                    <div className={`border border-slate-100 rounded-xl overflow-hidden mb-8 ${isLocked ? 'opacity-75' : ''}`}>
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                                <tr>
                                    <th className="px-4 py-3 text-left">Concepto</th>
                                    <th className="px-4 py-3 text-right">Base</th>
                                    <th className="px-4 py-3 text-right">IVA %</th>
                                    <th className="px-4 py-3 text-right">IVA €</th>
                                    <th className="px-4 py-3 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                                {invoice.lines.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-8 text-center text-slate-400 italic">
                                            Sin líneas de detalle
                                        </td>
                                    </tr>
                                ) : (
                                    invoice.lines.map((line, idx) => {
                                        const lineTotal = line.amount + (line.vatAmount || 0);
                                        return (
                                            <tr key={idx}>
                                                <td className="px-4 py-3 text-slate-700">{line.concept}</td>
                                                <td className="px-4 py-3 text-slate-600 font-mono text-right">
                                                    {line.amount.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                                                </td>
                                                <td className="px-4 py-3 text-slate-600 font-mono text-right">{line.vatRate}%</td>
                                                <td className="px-4 py-3 text-slate-600 font-mono text-right">
                                                    {(line.vatAmount || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                                                </td>
                                                <td className="px-4 py-3 text-slate-900 font-mono text-right">
                                                    {lineTotal.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                            <tfoot className="bg-emerald-50/30 text-slate-900 font-bold border-t border-emerald-100">
                                <tr>
                                    <td colSpan={4} className="px-4 py-3 text-right uppercase tracking-widest text-[10px] text-emerald-900">Total</td>
                                    <td className="px-4 py-3 text-right text-emerald-700 font-mono text-sm">
                                        {invoice.total.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Notes */}
                    {invoice.notes && (
                        <div className="mb-6 p-4 bg-slate-50 rounded-lg">
                            <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Notas</span>
                            <p className="text-sm text-slate-600">{invoice.notes}</p>
                        </div>
                    )}

                    {/* Meta */}
                    <div className="flex gap-4 text-[10px] text-slate-400 font-mono">
                        <div>Creado: {new Date(invoice.createdAt).toLocaleString()}</div>
                        {invoice.issuedAt && (
                            <div>Emitido: {new Date(invoice.issuedAt).toLocaleString()}</div>
                        )}
                        {invoice.paidAt && (
                            <div>Pagado: {new Date(invoice.paidAt).toLocaleString()}</div>
                        )}
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
                    <div className="flex gap-2">
                        <button
                            onClick={handleDelete}
                            disabled={updating}
                            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {invoice.status === 'draft' ? (
                                <><Trash2 size={14} /> Eliminar</>
                            ) : (
                                <><Ban size={14} /> Anular</>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Confirmation Modal */}
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

export default InvoiceDetailModal;
