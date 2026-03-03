export const CONFIG_DESTRUCTIVE_BYPASS_TOKEN = 'PROTEGER_CONFIG_ACEPTO';

interface DestructiveOptions {
  bypassToken?: string;
}

export function assertConfigDestructiveAllowed(entityLabel: string, options?: DestructiveOptions): void {
  if (options?.bypassToken === CONFIG_DESTRUCTIVE_BYPASS_TOKEN) {
    return;
  }

  throw new Error(
    `Operación bloqueada por seguridad en ${entityLabel}. ` +
    `Esta configuración está protegida para evitar pérdidas accidentales.`
  );
}

