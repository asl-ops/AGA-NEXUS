import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';

type InputClearButtonProps = {
    onClick: () => void;
    className?: string;
    title?: string;
    disabled?: boolean;
};

export const InputClearButton: React.FC<InputClearButtonProps> = ({
    onClick,
    className,
    title = 'Limpiar campo',
    disabled = false
}) => {
    return (
        <button
            type="button"
            onClick={() => {
                if (disabled) return;
                onClick();
            }}
            title={title}
            aria-label={title}
            disabled={disabled}
            className={cn(
                'z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60',
                className
            )}
        >
            <X className="h-3.5 w-3.5" />
        </button>
    );
};
