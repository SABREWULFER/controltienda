import { EmployeeWorkStatus, TimeLog, TimeLogType } from '@/types/database';

export const TIMEZONE = 'Europe/Madrid';

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
        editsList.push(
          `Editado por ${log.edited_by} (${formatDateTimeSpain(log.edited_at)})`
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
