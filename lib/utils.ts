import { EmployeeWorkStatus, TimeLog, TimeLogType } from '@/types/database';

export const TIMEZONE = 'Europe/Madrid';

/**
 * Extrae el mensaje real de error tanto de instancias Error como de objetos PostgrestError de Supabase
 */
export function getErrorMessage(err: unknown): string {
  if (!err) return 'Error desconocido';
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message.trim() !== '') {
      const details =
        typeof obj.details === 'string' && obj.details.trim() !== ''
          ? ` (${obj.details})`
          : '';
      const hint =
        typeof obj.hint === 'string' && obj.hint.trim() !== ''
          ? ` - Sugerencia: ${obj.hint}`
          : '';
      return `${obj.message}${details}${hint}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Comprueba si una cadena tiene formato UUID válido
 */
export function isValidUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

/**
 * Formatea una fecha ISO en formato español legible (Europe/Madrid)
 */
export function formatDateTimeSpain(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return String(isoString);
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatDateSpain(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return String(isoString);
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function formatTimeSpain(isoString: string | null | undefined): string {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return String(isoString);
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Convierte un ISO string al formato requerido por <input type="datetime-local"> en hora Europe/Madrid
 */
export function toMadridDateTimeLocalValue(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/**
 * Convierte un valor de <input type="datetime-local"> (YYYY-MM-DDTHH:mm) a un ISO string válido
 */
export function fromDateTimeLocalToISO(value: string): string | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();

  // Desglosar explícitamente YYYY-MM-DDTHH:mm[:ss] para evitar fallos en navegadores
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] || 0);
    const localDate = new Date(year, month - 1, day, hour, minute, second);
    if (!isNaN(localDate.getTime())) {
      return localDate.toISOString();
    }
  }

  const fallback = new Date(trimmed);
  if (!isNaN(fallback.getTime())) {
    return fallback.toISOString();
  }
  return null;
}

/**
 * Determina el estado actual del empleado según su último registro en time_logs
 */
export function getEmployeeStatusFromLastLog(
  lastLog?: Pick<TimeLog, 'type'> | null
): EmployeeWorkStatus {
  if (!lastLog) return 'OUTSIDE';
  switch (lastLog.type) {
    case 'IN':
    case 'PAUSE_END':
      return 'WORKING';
    case 'PAUSE_START':
      return 'PAUSED';
    case 'OUT':
    default:
      return 'OUTSIDE';
  }
}

export function getTimeLogTypeLabel(type: TimeLogType): string {
  switch (type) {
    case 'IN':
      return 'Entrada';
    case 'OUT':
      return 'Salida';
    case 'PAUSE_START':
      return 'Inicio Pausa';
    case 'PAUSE_END':
      return 'Fin Pausa';
    default:
      return type;
  }
}

export function getStatusLabel(status: EmployeeWorkStatus): string {
  switch (status) {
    case 'WORKING':
      return 'DENTRO (Trabajando)';
    case 'PAUSED':
      return 'EN PAUSA';
    case 'OUTSIDE':
      return 'FUERA DE TURNO';
  }
}

export interface DailyWorkSummary {
  dateKey: string; // DD/MM/YYYY in Europe/Madrid
  employeeId: string;
  employeeName: string;
  employeeDni: string;
  firstIn: string | null;
  lastOut: string | null;
  pauseMinutes: number;
  workedMinutes: number;
  workedFormatted: string;
  workedDecimalHours: number;
  logsCount: number;
  notesSummary: string;
  editedSummary: string;
}

export function formatMinutesToHHMM(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * Calcula las horas trabajadas por empleado y jornada (día en Europe/Madrid)
 * para el informe oficial de Inspección de Trabajo.
 */
export function calculateDailyWorkSummaries(logs: TimeLog[]): DailyWorkSummary[] {
  // Ordenar cronológicamente ascendente
  const sorted = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const grouped = new Map<string, TimeLog[]>();

  for (const log of sorted) {
    const dateStr = formatDateSpain(log.timestamp);
    const key = `${log.employee_id}__${dateStr}`;
    const arr = grouped.get(key) || [];
    arr.push(log);
    grouped.set(key, arr);
  }

  const summaries: DailyWorkSummary[] = [];

  for (const [, dayLogs] of grouped.entries()) {
    if (dayLogs.length === 0) continue;
    const firstSample = dayLogs[0];
    const empName = firstSample.employees?.name || 'Empleado';
    const empDni = firstSample.employees?.dni || '-';
    const dateKey = formatDateSpain(firstSample.timestamp);

    let firstIn: string | null = null;
    let lastOut: string | null = null;
    let workStartMs: number | null = null;
    let pauseStartMs: number | null = null;
    let totalWorkedMs = 0;
    let totalPauseMs = 0;

    const notesList: string[] = [];
    const editsList: string[] = [];

    for (const log of dayLogs) {
      const t = new Date(log.timestamp).getTime();
      if (isNaN(t)) continue;

      if (log.notes) notesList.push(log.notes);
      if (log.edited_by) {
        const editorLabel = log.editor
          ? `${log.editor.name} (${log.editor.dni})`
          : log.edited_by;
        editsList.push(
          `Editado por ${editorLabel} (${formatDateTimeSpain(log.edited_at)})`
        );
      }

      if (log.type === 'IN') {
        if (!firstIn) firstIn = formatTimeSpain(log.timestamp);
        if (workStartMs === null) {
          workStartMs = t;
        }
      } else if (log.type === 'PAUSE_START') {
        if (workStartMs !== null) {
          totalWorkedMs += Math.max(0, t - workStartMs);
          workStartMs = null;
        }
        if (pauseStartMs === null) {
          pauseStartMs = t;
        }
      } else if (log.type === 'PAUSE_END') {
        if (pauseStartMs !== null) {
          totalPauseMs += Math.max(0, t - pauseStartMs);
          pauseStartMs = null;
        }
        if (workStartMs === null) {
          workStartMs = t;
        }
      } else if (log.type === 'OUT') {
        lastOut = formatTimeSpain(log.timestamp);
        if (pauseStartMs !== null) {
          totalPauseMs += Math.max(0, t - pauseStartMs);
          pauseStartMs = null;
        }
        if (workStartMs !== null) {
          totalWorkedMs += Math.max(0, t - workStartMs);
          workStartMs = null;
        }
      }
    }

    const workedMinutes = totalWorkedMs / 60000;
    const pauseMinutes = totalPauseMs / 60000;

    summaries.push({
      dateKey,
      employeeId: firstSample.employee_id,
      employeeName: empName,
      employeeDni: empDni,
      firstIn,
      lastOut,
      pauseMinutes: Math.round(pauseMinutes),
      workedMinutes: Math.round(workedMinutes),
      workedFormatted: formatMinutesToHHMM(workedMinutes),
      workedDecimalHours: Number((workedMinutes / 60).toFixed(2)),
      logsCount: dayLogs.length,
      notesSummary: notesList.join(' | '),
      editedSummary: editsList.join(' | '),
    });
  }

  return summaries;
}

/**
 * Obtiene el rango ISO [start, end] para un mes (1-12) y año dados
 */
export function getMonthDateRangeISO(year: number, month: number): {
  startISO: string;
  endISO: string;
} {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  // Restamos 2 horas al inicio para cubrir el cambio de zona horaria Europe/Madrid
  start.setUTCHours(start.getUTCHours() - 2);
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}

/**
 * Comprueba si una fecha ISO pertenece exactamente al mes (1-12) y año en zona horaria Europe/Madrid
 */
export function isInMadridMonthYear(
  isoString: string,
  year: number,
  month: number
): boolean {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return false;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  return y === year && m === month;
}
