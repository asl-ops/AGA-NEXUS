export type HelpKeyBinding = {
    key: string;
    action: string;
};

export type HelpContent = {
    title: string;
    summary: string;
    whatIs?: string[];
    whatCanDo?: string[];
    whatSeeing?: string[];
    whySlow?: string[];
    howFaster?: string[];
    recommendedFlow?: string[];
    usage: string[];
    keys: HelpKeyBinding[];
    tips?: string[];
};

export type AppHelpView =
    | 'clients'
    | 'dashboard'
    | 'detail'
    | 'billing'
    | 'proformas'
    | 'invoices'
    | 'cash'
    | 'preapertura'
    | 'economico'
    | 'config'
    | 'tasks'
    | 'responsible'
    | 'legacy'
    | string;

export const HELP_FALLBACK: HelpContent = {
    title: 'Ayuda de Pantalla',
    summary: 'Esta pantalla muestra información dinámica según el contexto actual.',
    whatIs: [
        'Esta vista forma parte del flujo operativo de AGA Nexus y adapta contenido según cliente, filtros y navegación.'
    ],
    whatCanDo: [
        'Consultar información del módulo activo.',
        'Aplicar filtros o búsquedas.',
        'Abrir detalle cuando lo necesites.'
    ],
    whatSeeing: [
        'Los datos que ves se cargan desde fuentes importadas y registros internos.',
        'Si no hay cliente o filtros, la vista puede mostrarse vacía por diseño.'
    ],
    whySlow: [
        'Algunos módulos cargan el detalle bajo demanda para priorizar fluidez global.',
        'Cuando una consulta recorre histórico amplio, el tiempo puede aumentar unos segundos.'
    ],
    howFaster: [
        'Selecciona cliente antes de abrir detalle.',
        'Usa Enter para ejecutar acciones y Backspace para limpiar campos.',
        'Abre solo las pestañas que realmente necesites.'
    ],
    recommendedFlow: [
        'Seleccionar contexto',
        'Revisar resumen',
        'Abrir detalle específico',
        'Aplicar acciones'
    ],
    usage: [
        'Introduce datos en los campos disponibles.',
        'Usa Enter para ejecutar acciones rápidas cuando el campo lo permita.',
        'Usa Backspace para borrar contenido en campos editables.'
    ],
    keys: [
        { key: 'Enter', action: 'Ejecutar acción principal del campo activo.' },
        { key: 'Backspace', action: 'Borrar caracteres o limpiar campo si está vacío.' }
    ],
    tips: [
        'Si hay un cliente activo global, se aplicará automáticamente donde corresponda.'
    ]
};

export const HELP_REGISTRY: Record<string, HelpContent> = {
    clients: {
        title: 'Clientes',
        summary: 'Centro de consulta y acceso a toda la información vinculada a clientes.',
        whatIs: [
            'Esta pantalla centraliza la búsqueda y activación del cliente con el que trabajas en el resto de módulos.'
        ],
        whatCanDo: [
            'Buscar por nombre, NIF/CIF o identificador.',
            'Abrir ficha y contexto de cliente.',
            'Arrastrar el cliente activo al resto de secciones.'
        ],
        whatSeeing: [
            'Datos indexados y normalizados desde importaciones y base operativa.',
            'El identificador activo de sesión condiciona lo que ves en otras pantallas.'
        ],
        whySlow: [
            'Si el cliente tiene mucho histórico, el detalle se carga bajo demanda para no bloquear la vista principal.'
        ],
        howFaster: [
            'Escribe identificador directo y pulsa Enter.',
            'Usa Recientes para cambiar rápidamente de cliente.',
            'Fija con 📌 cuando vayas a trabajar solo un cliente.'
        ],
        recommendedFlow: ['Buscar', 'Seleccionar', 'Verificar datos básicos', 'Navegar a módulo objetivo'],
        usage: [
            'Escribe en el buscador por nombre, NIF o identificador.',
            'Pulsa Enter para confirmar la búsqueda.',
            'Selecciona un cliente para abrir su contexto.'
        ],
        keys: [
            { key: 'Enter', action: 'Ejecuta búsqueda en el campo activo.' },
            { key: 'Backspace', action: 'Borra caracteres o limpia el campo si está vacío.' }
        ],
        tips: ['El cliente seleccionado se arrastra automáticamente a otros módulos.']
    },
    dashboard: {
        title: 'Expedientes',
        summary: 'Gestión de expedientes asociados al cliente activo.',
        whatIs: [
            'Aquí controlas expedientes abiertos/cerrados, su estado y los datos operativos asociados.'
        ],
        whatCanDo: [
            'Buscar expedientes por identificador o filtros.',
            'Ordenar, seleccionar y abrir detalle.',
            'Aplicar acciones desde la columna Acciones.'
        ],
        whatSeeing: [
            'Listado operativo sincronizado con la base activa.',
            'Si el explorador está vacío, falta cliente/filtro o no hay resultados para el criterio actual.'
        ],
        whySlow: [
            'Algunos detalles de expediente cargan movimientos y documentos asociados al abrir el registro.'
        ],
        howFaster: [
            'Filtra primero y abre solo los expedientes necesarios.',
            'Usa columnas redimensionables para ver mejor los campos clave.'
        ],
        recommendedFlow: ['Seleccionar cliente', 'Filtrar', 'Revisar listado', 'Abrir expediente'],
        usage: [
            'Selecciona cliente o identificador.',
            'Visualiza expedientes y su estado.',
            'Abre detalle para editar movimientos y datos.'
        ],
        keys: [
            { key: 'Enter', action: 'Buscar expediente/identificador.' },
            { key: 'Backspace', action: 'Limpiar identificador en búsqueda.' }
        ],
        tips: ['Seleccionar un cliente aquí lo activa globalmente para toda la app.']
    },
    detail: {
        title: 'Detalle de Expediente',
        summary: 'Vista completa de edición y seguimiento del expediente.',
        whatIs: [
            'Es la ficha operativa donde se consolidan datos de cliente, gestión, movimientos y documentación del expediente.'
        ],
        whatCanDo: [
            'Editar campos del expediente.',
            'Revisar movimientos y totales.',
            'Guardar y verificar información.'
        ],
        whatSeeing: [
            'Información viva del expediente seleccionado, no un informe estático.'
        ],
        whySlow: [
            'La vista puede tardar al cargar histórico de movimientos o adjuntos asociados.'
        ],
        howFaster: [
            'Edita por bloques y guarda de forma incremental.',
            'Usa copiar identificador para evitar búsquedas repetidas.'
        ],
        recommendedFlow: ['Revisar cabecera', 'Actualizar datos', 'Validar importes', 'Guardar/verificar'],
        usage: [
            'Revisa datos generales y económicos.',
            'Añade o ajusta movimientos del expediente.',
            'Guarda cambios para actualizar el estado del caso.'
        ],
        keys: [
            { key: 'Enter', action: 'Confirmar edición en campos compatibles.' },
            { key: 'Backspace', action: 'Corregir contenido en campos activos.' }
        ],
        tips: ['Usa las acciones laterales para navegar sin perder el contexto del cliente.']
    },
    billing: {
        title: 'Albaranes',
        summary: 'Listado de albaranes y transición a facturación.',
        whatIs: [
            'Módulo de documentos intermedios previos a facturación.'
        ],
        whatCanDo: [
            'Buscar albaranes por cliente, fecha o identificador.',
            'Revisar estado de albaranes.',
            'Preparar incorporación a proformas/facturas.'
        ],
        whatSeeing: [
            'Datos operativos vinculados a clientes y procesos administrativos.'
        ],
        whySlow: [
            'Puede tardar al consultar lotes históricos o documentos con trazabilidad amplia.'
        ],
        howFaster: [
            'Trabaja con filtro por cliente y ejercicio antes de ampliar resultados.'
        ],
        recommendedFlow: ['Seleccionar cliente', 'Filtrar', 'Revisar', 'Preparar integración'],
        usage: [
            'Introduce filtro o identificador.',
            'Pulsa Enter para ejecutar búsqueda.',
            'Selecciona registros para acciones disponibles.'
        ],
        keys: [
            { key: 'Enter', action: 'Ejecutar búsqueda/confirmar filtro.' },
            { key: 'Backspace', action: 'Borrar el valor del filtro activo.' }
        ],
        tips: ['Próximamente podrás incorporar albaranes directamente a proformas y facturas.']
    },
    proformas: {
        title: 'Proformas',
        summary: 'Creación y gestión de facturas proforma previas a emisión final.',
        whatIs: [
            'Área de trabajo para preparar documentos preliminares sin impacto contable definitivo.'
        ],
        whatCanDo: [
            'Crear, editar y revisar proformas.',
            'Gestionar conceptos e importes antes de factura final.'
        ],
        whatSeeing: [
            'Documentos previos y sus líneas de concepto.'
        ],
        whySlow: [
            'Puede cargar más lento si hay muchas líneas o historial asociado del cliente.'
        ],
        howFaster: [
            'Selecciona cliente primero para evitar recargas.',
            'Usa Enter para confirmar campos rápidos.'
        ],
        recommendedFlow: ['Cliente', 'Crear/abrir proforma', 'Editar líneas', 'Guardar'],
        usage: [
            'Selecciona cliente o expediente.',
            'Crea/abre documento proforma.',
            'Añade conceptos y guarda.'
        ],
        keys: [
            { key: 'Enter', action: 'Confirmar campos de edición.' },
            { key: 'Backspace', action: 'Borrar valor en campo activo.' }
        ],
        tips: ['Usar cliente activo evita tener que buscarlo de nuevo.']
    },
    invoices: {
        title: 'Facturas',
        summary: 'Gestión completa de facturación (pendientes, cobradas y total).',
        whatIs: [
            'Explorador de facturas con filtros de estado y periodo para control operativo y económico.'
        ],
        whatCanDo: [
            'Buscar facturas por identificador, número y cliente.',
            'Filtrar por estado, ejercicio y fechas.',
            'Acceder a detalle de factura.'
        ],
        whatSeeing: [
            'Datos consolidados de facturación activa e histórica según filtros.'
        ],
        whySlow: [
            'Algunas consultas con periodos amplios o clientes con mucho volumen tardan más en resolverse.'
        ],
        howFaster: [
            'Empieza con cliente seleccionado y estado concreto (pendientes/cobradas).',
            'Evita abrir periodos muy amplios si no es necesario.'
        ],
        recommendedFlow: ['Seleccionar cliente', 'Elegir estado', 'Aplicar periodo', 'Abrir detalle'],
        usage: [
            'Selecciona cliente o identificador.',
            'Filtra por estado y ejercicio.',
            'Abre factura para revisar o gestionar.'
        ],
        keys: [
            { key: 'Enter', action: 'Aplicar búsqueda/filtro del campo activo.' },
            { key: 'Backspace', action: 'Borrar filtro o contenido del input.' }
        ],
        tips: ['La sesión recuerda el cliente activo para acelerar la navegación.']
    },
    cash: {
        title: 'Caja',
        summary: 'Gestión de movimientos económicos de caja y su trazabilidad.',
        whatIs: [
            'Registra cobros/pagos operativos y su relación con cliente/contexto.'
        ],
        whatCanDo: [
            'Registrar movimientos.',
            'Consultar histórico de caja.',
            'Filtrar por cliente y fecha.'
        ],
        whatSeeing: [
            'Movimientos operativos con impacto de control interno.'
        ],
        whySlow: [
            'Puede demorarse al recuperar histórico amplio de movimientos.'
        ],
        howFaster: [
            'Acota por fecha y cliente.',
            'Usa cliente activo para no repetir búsquedas.'
        ],
        recommendedFlow: ['Seleccionar contexto', 'Registrar/revisar movimiento', 'Confirmar'],
        usage: [
            'Selecciona cliente (opcional).',
            'Introduce concepto e importe.',
            'Guarda movimiento.'
        ],
        keys: [
            { key: 'Enter', action: 'Confirmar acción o guardar en formularios.' },
            { key: 'Backspace', action: 'Borrar entrada en campo activo.' }
        ],
        tips: ['Si hay cliente activo, se usará automáticamente cuando aplique.']
    },
    preapertura: {
        title: 'Expedientes en preapertura',
        summary: 'Módulo de preparación previa para aperturas masivas o guiadas.',
        whatIs: [
            'Permite configurar expedientes modelo antes de abrir expedientes reales.'
        ],
        whatCanDo: [
            'Preparar lotes de preapertura.',
            'Definir base para apertura global o seleccionada.'
        ],
        whatSeeing: [
            'Datos preliminares aún no consolidados como expediente definitivo.'
        ],
        whySlow: [
            'Puede requerir validaciones previas cuando hay plantillas o lotes grandes.'
        ],
        howFaster: [
            'Completa datos base primero.',
            'Revisa coherencia antes de confirmar aperturas.'
        ],
        recommendedFlow: ['Preparar', 'Revisar', 'Confirmar apertura'],
        usage: [
            'Registra configuraciones preliminares.',
            'Prepara lotes para apertura global o seleccionada.',
            'Convierte a expedientes activos cuando proceda.'
        ],
        keys: [
            { key: 'Enter', action: 'Confirmar formulario activo.' },
            { key: 'Backspace', action: 'Borrar contenido del campo.' }
        ],
        tips: ['Útil para ciclos mensuales donde hay aperturas recurrentes.']
    },
    economico: {
        title: 'Económico',
        summary: 'Panel financiero consolidado del cliente con resumen rápido y detalle bajo demanda.',
        whatIs: [
            'Esta sección integra saldos contables, movimientos de mayor, facturación y expedientes para ofrecer una vista única.'
        ],
        whatCanDo: [
            'Consultar KPIs financieros del cliente.',
            'Abrir detalle de expedientes abiertos.',
            'Abrir detalle de facturas pendientes.',
            'Explorar extracto mayor del cliente.'
        ],
        whatSeeing: [
            'No es una tabla estática: el sistema consolida fuentes diferentes según el cliente y filtros activos.'
        ],
        whySlow: [
            'Las pestañas de detalle se cargan en tiempo real bajo demanda para priorizar fluidez de la app.',
            'Consultas sobre histórico contable amplio pueden tardar unos segundos.'
        ],
        howFaster: [
            'Selecciona cliente primero.',
            'Usa 📌 para mantener contexto fijo.',
            'Abre solo la pestaña que necesites.'
        ],
        recommendedFlow: ['Seleccionar cliente', 'Revisar KPIs', 'Abrir detalle necesario', 'Analizar movimientos'],
        usage: [
            'Selecciona cliente o identificador.',
            'Revisa KPIs principales.',
            'Abre pestañas de detalle cuando necesites histórico.'
        ],
        keys: [
            { key: 'Enter', action: 'Aplicar búsqueda/filtro activo.' },
            { key: 'Backspace', action: 'Limpiar campo de filtro activo.' }
        ],
        tips: ['Si existe cliente activo global, su información se carga automáticamente.']
    },
    config: {
        title: 'Administración',
        summary: 'Configuración global del sistema y datos maestros.',
        whatIs: [
            'Zona de parámetros que afecta a toda la aplicación.'
        ],
        whatCanDo: [
            'Gestionar prefijos, catálogos y configuraciones generales.',
            'Ajustar comportamiento global.'
        ],
        whatSeeing: [
            'Valores de referencia usados por múltiples módulos.'
        ],
        whySlow: [
            'Algunas secciones cargan catálogos completos para edición segura.'
        ],
        howFaster: [
            'Modifica solo el bloque necesario y guarda de forma incremental.'
        ],
        recommendedFlow: ['Entrar en categoría', 'Editar parámetros', 'Guardar y validar'],
        usage: [
            'Selecciona categoría de administración.',
            'Modifica parámetros disponibles.',
            'Guarda cambios para aplicarlos globalmente.'
        ],
        keys: [
            { key: 'Enter', action: 'Confirmar edición en formularios compatibles.' },
            { key: 'Backspace', action: 'Borrar contenido en campos editables.' }
        ],
        tips: ['Los cambios aquí afectan al comportamiento global de la aplicación.']
    },
};
