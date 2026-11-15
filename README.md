# Control Tienda - Kiosco de Control Horario (RDL 8/2019) y Temperaturas APPCC (Sanidad)

Aplicación web progresiva (PWA) táctil en modo Kiosco construida con **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, **Lucide Icons**, **Supabase** y **SheetJS (`xlsx`)**.

## Características principales

1. **Modo Kiosco PWA Táctil (Instalable en Windows / Tablet)**:
   - Teclado numérico táctil grande de 4 dígitos (PIN admin inicial: `1234`).
   - Identificación instantánea del estado del trabajador (`DENTRO`, `EN PAUSA`, `FUERA DE TURNO`).
   - **Opción A - Fichar Jornada**: Entrada (`IN`), Iniciar Pausa (`PAUSE_START`), Fin de Pausa (`PAUSE_END`) y Salida (`OUT`) empleando la hora del servidor de Supabase, con confirmación visual de 3 segundos y retorno automático al teclado PIN.
   - **Opción B - Registrar Temperaturas APPCC**: Listado de neveras activas con validación en tiempo real del rango `[min_temp, max_temp]` y despliegue obligatorio de **Acción correctora tomada** cuando una lectura está fuera de rango.

2. **Panel de Administración (Rol `admin`)**:
   - **Pestaña 1 - Registros de Fichajes**: Filtro por mes/año y empleado, cálculo de horas trabajadas por jornada y edición auditada (`edited_by`, `edited_at`) sin permitir el borrado de registros.
   - **Pestaña 2 - Registros de Temperaturas**: Filtro por mes/año y nevera, resaltando en rojo las lecturas fuera de rango y su acción correctora.
   - **Pestaña 3 - Importador Visual de Histórico (Excel/CSV)**: Mapeo interactivo de columnas y volcado masivo a Supabase.
   - **Pestaña 4 - Gestión de Empleados y Neveras**: Alta, edición de PIN/rangos térmicos y activación/desactivación.

3. **Exportación Oficial a Excel (`.xlsx`)**:
   - **Exportar Excel Inspección Trabajo**: Resumen de horas trabajadas por jornada + detalle íntegro de fichajes y auditoría en zona horaria `Europe/Madrid`.
   - **Exportar Excel Sanidad (APPCC)**: Registro completo con rangos térmicos, estado APPCC y acciones correctoras en zona horaria `Europe/Madrid`.
