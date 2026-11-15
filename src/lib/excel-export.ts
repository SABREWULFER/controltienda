import * as XLSX from 'xlsx';
import { TemperatureLog, TimeLog } from '@/types/database';
import {
  calculateDailyWorkSummaries,
  formatDateSpain,
  formatDateTimeSpain,
  formatMinutesToHHMM,
  formatTimeSpain,
  getTimeLogTypeLabel,
} from './utils';

function autoFitColumns(rows: Record<string, unknown>[]): XLSX.ColInfo[] {
  if (!rows || rows.length === 0) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((key) => {
    const maxContentLen = rows.reduce((max, row) => {
      const val = row[key] === null || row[key] === undefined ? '' : String(row[key]);
      return Math.max(max, val.length);
    }, key.length);
    return { wch: Math.min(Math.max(maxContentLen + 4, 12), 55) };
  });
}

/**
 * Genera y descarga el archivo Excel (.xlsx) para la Inspección de Trabajo y Seguridad Social (España)
 * Incluye:
 * - Hoja 1: Resumen Diario de Jornadas (horas trabajadas por jornada, pausas, entrada/salida, total mensual)
 * - Hoja 2: Detalle Íntegro de Fichajes (con trazabilidad de auditoría edited_by / edited_at)
 */
export function exportLaborInspectionExcel(
  logs: TimeLog[],
  year: number,
  month: number,
  employeeFilterName?: string
): void {
  const monthStr = String(month).padStart(2, '0');
  const summaries = calculateDailyWorkSummaries(logs);

  const summaryRows = summaries.map((s) => ({
    'Fecha (Europe/Madrid)': s.dateKey,
    Empleado: s.employeeName,
    'DNI / NIE': s.employeeDni,
    'Primera Entrada': s.firstIn || '-',
    'Última Salida': s.lastOut || '-',
    'Tiempo Pausa (min)': s.pauseMinutes,
    'Horas Trabajadas (HH:MM)': s.workedFormatted,
    'Horas Trabajadas (Decimal)': s.workedDecimalHours,
    'Nº Marcajes': s.logsCount,
    Observaciones: s.notesSummary || '-',
    'Auditoría Modificaciones': s.editedSummary || 'Original sin cambios',
  }));

  // Fila totalizadora al final del resumen por jornada
  const totalMinutesAll = summaries.reduce((acc, s) => acc + s.workedMinutes, 0);
  const totalPauseAll = summaries.reduce((acc, s) => acc + s.pauseMinutes, 0);

  if (summaryRows.length > 0) {
    summaryRows.push({
      'Fecha (Europe/Madrid)': 'TOTAL ACUMULADO PERIODO',
      Empleado: employeeFilterName || 'TODOS LOS EMPLEADOS',
      'DNI / NIE': '-',
      'Primera Entrada': '-',
      'Última Salida': '-',
      'Tiempo Pausa (min)': totalPauseAll,
      'Horas Trabajadas (HH:MM)': formatMinutesToHHMM(totalMinutesAll),
      'Horas Trabajadas (Decimal)': Number((totalMinutesAll / 60).toFixed(2)),
      'Nº Marcajes': logs.length,
      Observaciones: `Periodo ${monthStr}/${year}`,
      'Auditoría Modificaciones': '-',
    });
  }

  // Ordenar logs detallados cronológicamente
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Calcular horas por jornada también en el detalle cuando hay un OUT
  const dailyMap = new Map<string, string>();
  for (const s of summaries) {
    dailyMap.set(`${s.employeeId}__${s.dateKey}`, s.workedFormatted);
  }

  const detailRows = sortedLogs.map((log) => {
    const dateKey = formatDateSpain(log.timestamp);
    const dailyTotal =
      dailyMap.get(`${log.employee_id}__${dateKey}`) || '00h 00m';
    return {
      'Fecha (Europe/Madrid)': dateKey,
      'Hora (Europe/Madrid)': formatTimeSpain(log.timestamp),
      'Fecha y Hora Completa': formatDateTimeSpain(log.timestamp),
      Empleado: log.employees?.name || '-',
      'DNI / NIE': log.employees?.dni || '-',
      'Tipo de Fichaje': getTimeLogTypeLabel(log.type),
      'Total Jornada Día': dailyTotal,
      Notas: log.notes || '-',
      'Modificado Por': log.edited_by || 'Original',
      'Fecha Modificación': log.edited_at
        ? formatDateTimeSpain(log.edited_at)
        : '-',
    };
  });

  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(
    summaryRows.length > 0
      ? summaryRows
      : [
          {
            Mensaje: `Sin registros de jornada para ${monthStr}/${year}`,
          },
        ]
  );
  summarySheet['!cols'] = autoFitColumns(
    summaryRows.length > 0
      ? summaryRows
      : [{ Mensaje: `Sin registros de jornada para ${monthStr}/${year}` }]
  );
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumen Jornadas');

  const detailSheet = XLSX.utils.json_to_sheet(
    detailRows.length > 0
      ? detailRows
      : [
          {
            Mensaje: `Sin fichajes detallados para ${monthStr}/${year}`,
          },
        ]
  );
  detailSheet['!cols'] = autoFitColumns(
    detailRows.length > 0
      ? detailRows
      : [{ Mensaje: `Sin fichajes detallados para ${monthStr}/${year}` }]
  );
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Detalle Fichajes');

  const fileName = `Inspeccion_Trabajo_${year}_${monthStr}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}

/**
 * Genera y descarga el archivo Excel (.xlsx) para Inspección de Sanidad (Control APPCC)
 */
export function exportSanidadAppccExcel(
  logs: TemperatureLog[],
  year: number,
  month: number
): void {
  const monthStr = String(month).padStart(2, '0');

  const sortedLogs = [...logs].sort(
    (a, b) =>
      new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  const rows = sortedLogs.map((log) => {
    const min = log.fridges?.min_temp;
    const max = log.fridges?.max_temp;
    const temp = Number(log.temperature);
    const hasRange = min !== undefined && max !== undefined && min !== null && max !== null;
    const outOfRange = hasRange ? temp < Number(min) || temp > Number(max) : false;

    return {
      'Fecha (Europe/Madrid)': formatDateSpain(log.recorded_at),
      'Hora (Europe/Madrid)': formatTimeSpain(log.recorded_at),
      'Fecha y Hora Completa': formatDateTimeSpain(log.recorded_at),
      'Equipo / Nevera': log.fridges?.name || '-',
      'Temperatura Registrada (°C)': temp,
      'Rango Permitido (°C)': hasRange ? `${min}°C a ${max}°C` : '-',
      'Temp. Mínima (°C)': hasRange ? Number(min) : '-',
      'Temp. Máxima (°C)': hasRange ? Number(max) : '-',
      'Estado APPCC': outOfRange ? 'INCIDENCIA (FUERA DE RANGO)' : 'CORRECTO',
      'Acción Correctora Tomada': log.corrective_action || (outOfRange ? 'Sin especificar' : 'No requerida'),
      'Registrado Por (Empleado)': log.employees?.name || '-',
      'DNI Empleado': log.employees?.dni || '-',
    };
  });

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(
    rows.length > 0
      ? rows
      : [
          {
            Mensaje: `Sin registros de temperatura APPCC para ${monthStr}/${year}`,
          },
        ]
  );
  sheet['!cols'] = autoFitColumns(
    rows.length > 0
      ? rows
      : [
          {
            Mensaje: `Sin registros de temperatura APPCC para ${monthStr}/${year}`,
          },
        ]
  );
  XLSX.utils.book_append_sheet(workbook, sheet, 'Control APPCC Temperaturas');

  const fileName = `Sanidad_APPCC_Temperaturas_${year}_${monthStr}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
