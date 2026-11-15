'use client';

import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Database,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Employee, Fridge, TimeLogType } from '@/types/database';

interface CsvExcelImporterProps {
  employees: Employee[];
  fridges: Fridge[];
  currentAdmin: Employee;
  onImportSuccess: () => void;
}

type ImportTarget = 'time_logs' | 'temperature_logs';

function parseFlexibleDate(
  rawDate: unknown,
  rawTime?: unknown
): string | null {
  if (rawDate === null || rawDate === undefined || rawDate === '') return null;

  // Caso 1: Número serie de fecha de Excel (ej. 45245.5416)
  if (typeof rawDate === 'number') {
    const utcDays = Math.floor(rawDate - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    const fractionalDay = rawDate - Math.floor(rawDate) + 0.0000001;
    let totalSeconds = Math.floor(86400 * fractionalDay);
    const seconds = totalSeconds % 60;
    totalSeconds -= seconds;
    const hours = Math.floor(totalSeconds / (60 * 60));
    const minutes = Math.floor(totalSeconds / 60) % 60;

    const d = new Date(
      dateInfo.getUTCFullYear(),
      dateInfo.getUTCMonth(),
      dateInfo.getUTCDate(),
      hours,
      minutes,
      seconds
    );

    if (rawTime !== undefined && rawTime !== null && rawTime !== '') {
      if (typeof rawTime === 'number' && rawTime < 1) {
        const tSec = Math.round(86400 * rawTime);
        d.setHours(
          Math.floor(tSec / 3600),
          Math.floor((tSec % 3600) / 60),
          tSec % 60
        );
      } else if (typeof rawTime === 'string') {
        const parts = rawTime.trim().split(':');
        if (parts.length >= 2) {
          d.setHours(
            Number(parts[0]) || 0,
            Number(parts[1]) || 0,
            Number(parts[2]) || 0
          );
        }
      }
    }

    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Caso 2: Texto en formato DD/MM/YYYY o YYYY-MM-DD
  let str = String(rawDate).trim();
  if (rawTime !== undefined && rawTime !== null && String(rawTime).trim() !== '') {
    str = `${str} ${String(rawTime).trim()}`;
  }

  // Formato español DD/MM/YYYY [HH:mm[:ss]]
  const esMatch = str.match(
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/
  );
  if (esMatch) {
    const day = Number(esMatch[1]);
    const month = Number(esMatch[2]);
    let year = Number(esMatch[3]);
    if (year < 100) year += 2000;
    const hour = Number(esMatch[4] || 12);
    const min = Number(esMatch[5] || 0);
    const sec = Number(esMatch[6] || 0);
    const d = new Date(year, month - 1, day, hour, min, sec);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Intento directo Date.parse (ISO o YYYY-MM-DD)
  const direct = new Date(str);
  if (!isNaN(direct.getTime())) return direct.toISOString();

  return null;
}

function normalizeTimeLogType(raw: unknown): TimeLogType {
  const val = String(raw || '')
    .trim()
    .toUpperCase();
  if (
    val === 'IN' ||
    val.includes('ENTRADA') ||
    val.includes('INICIO JORNADA') ||
    val === 'E'
  ) {
    return 'IN';
  }
  if (
    val === 'OUT' ||
    val.includes('SALIDA') ||
    val.includes('FIN JORNADA') ||
    val === 'S'
  ) {
    return 'OUT';
  }
  if (
    val === 'PAUSE_START' ||
    val.includes('INICIO PAUSA') ||
    val.includes('PAUSA') ||
    val.includes('DESCANSO')
  ) {
    return 'PAUSE_START';
  }
  if (
    val === 'PAUSE_END' ||
    val.includes('FIN PAUSA') ||
    val.includes('REANUDAR') ||
    val.includes('VUELTA')
  ) {
    return 'PAUSE_END';
  }
  return 'IN';
}

export default function CsvExcelImporter({
  employees,
  fridges,
  currentAdmin,
  onImportSuccess,
}: CsvExcelImporterProps) {
  const [target, setTarget] = useState<ImportTarget>('time_logs');
  const [fileName, setFileName] = useState<string>('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  // Mapeo de columnas para time_logs
  const [colEmployee, setColEmployee] = useState<string>('');
  const [colType, setColType] = useState<string>('');
  const [colDate, setColDate] = useState<string>('');
  const [colTime, setColTime] = useState<string>('');
  const [colNotes, setColNotes] = useState<string>('');
  const [fallbackEmployeeId, setFallbackEmployeeId] = useState<string>(
    currentAdmin.id
  );

  // Mapeo de columnas para temperature_logs
  const [colFridge, setColFridge] = useState<string>('');
  const [colTempValue, setColTempValue] = useState<string>('');
  const [colTempDate, setColTempDate] = useState<string>('');
  const [colTempTime, setColTempTime] = useState<string>('');
  const [colTempEmployee, setColTempEmployee] = useState<string>('');
  const [colCorrective, setColCorrective] = useState<string>('');
  const [fallbackFridgeId, setFallbackFridgeId] = useState<string>(
    fridges[0]?.id || ''
  );

  const [importing, setImporting] = useState(false);
  const [resultMsg, setResultMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setResultMsg(null);
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        worksheet,
        { defval: '' }
      );

      if (jsonData.length === 0) {
        setResultMsg({
          type: 'error',
          text: 'El archivo seleccionado está vacío o no contiene filas válidas.',
        });
        setHeaders([]);
        setRows([]);
        return;
      }

      const detectedHeaders = Object.keys(jsonData[0]);
      setHeaders(detectedHeaders);
      setRows(jsonData);

      // Auto-detección inteligente de columnas
      const findHeader = (keywords: string[]) =>
        detectedHeaders.find((h) =>
          keywords.some((k) => h.toLowerCase().includes(k.toLowerCase()))
        ) || '';

      setColEmployee(
        findHeader(['empleado', 'nombre', 'trabajador', 'dni', 'employee', 'usuario'])
      );
      setColType(findHeader(['tipo', 'type', 'accion', 'acción', 'evento', 'marcaje']));
      setColDate(
        findHeader(['fecha', 'date', 'timestamp', 'dia', 'día', 'fechahora'])
      );
      setColTime(findHeader(['hora', 'time']));
      setColNotes(findHeader(['nota', 'observacion', 'comentario', 'note']));

      setColFridge(
        findHeader(['nevera', 'equipo', 'camara', 'cámara', 'fridge', 'congelador'])
      );
      setColTempValue(
        findHeader(['temperatura', 'temp', 'grados', 'lectura', 'valor', 'ºc', '°c'])
      );
      setColTempDate(
        findHeader(['fecha', 'date', 'recorded', 'dia', 'día'])
      );
      setColTempTime(findHeader(['hora', 'time']));
      setColTempEmployee(
        findHeader(['empleado', 'responsable', 'operario', 'employee'])
      );
      setColCorrective(
        findHeader(['correctora', 'incidencia', 'accion', 'acción', 'corrective'])
      );
    } catch (err) {
      setResultMsg({
        type: 'error',
        text: `Error al leer el archivo: ${
          err instanceof Error ? err.message : 'Formato no reconocido'
        }`,
      });
    }
  };

  const resolveEmployeeId = (rawVal: unknown): string => {
    if (!rawVal) return fallbackEmployeeId || currentAdmin.id;
    const str = String(rawVal).trim().toLowerCase();
    const matched = employees.find(
      (e) =>
        e.id.toLowerCase() === str ||
        e.name.toLowerCase() === str ||
        e.dni.toLowerCase() === str ||
        e.name.toLowerCase().includes(str) ||
        str.includes(e.name.toLowerCase())
    );
    return matched ? matched.id : fallbackEmployeeId || currentAdmin.id;
  };

  const resolveFridgeId = (rawVal: unknown): string | null => {
    if (!rawVal) return fallbackFridgeId || fridges[0]?.id || null;
    const str = String(rawVal).trim().toLowerCase();
    const matched = fridges.find(
      (f) =>
        f.id.toLowerCase() === str ||
        f.name.toLowerCase() === str ||
        f.name.toLowerCase().includes(str) ||
        str.includes(f.name.toLowerCase())
    );
    return matched ? matched.id : fallbackFridgeId || fridges[0]?.id || null;
  };

  const handleBulkImport = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    setResultMsg(null);

    try {
      if (target === 'time_logs') {
        if (!colDate) {
          setResultMsg({
            type: 'error',
            text: 'Debes seleccionar al menos la columna de Fecha / Fecha-Hora.',
          });
          setImporting(false);
          return;
        }

        const payload: Array<{
          employee_id: string;
          type: TimeLogType;
          timestamp: string;
          notes: string | null;
          edited_by: string;
          edited_at: string;
        }> = [];

        let skipped = 0;
        const nowIso = new Date().toISOString();

        for (const row of rows) {
          const parsedIso = parseFlexibleDate(
            row[colDate],
            colTime ? row[colTime] : undefined
          );
          if (!parsedIso) {
            skipped++;
            continue;
          }

          const empId = colEmployee
            ? resolveEmployeeId(row[colEmployee])
            : fallbackEmployeeId || currentAdmin.id;
          const typeVal = colType ? normalizeTimeLogType(row[colType]) : 'IN';
          const notesVal =
            colNotes && row[colNotes]
              ? String(row[colNotes]).trim()
              : 'Importado desde histórico Excel/CSV';

          payload.push({
            employee_id: empId,
            type: typeVal,
            timestamp: parsedIso,
            notes: notesVal,
            edited_by: `${currentAdmin.name} (Importación Histórica)`,
            edited_at: nowIso,
          });
        }

        if (payload.length === 0) {
          setResultMsg({
            type: 'error',
            text: 'No se pudo extraer ninguna fila con fecha válida. Verifica el mapeo de columnas.',
          });
          setImporting(false);
          return;
        }

        // Insertar por lotes de 200 registros
        const batchSize = 200;
        for (let i = 0; i < payload.length; i += batchSize) {
          const chunk = payload.slice(i, i + batchSize);
          const { error } = await supabase.from('time_logs').insert(chunk);
          if (error) throw error;
        }

        setResultMsg({
          type: 'success',
          text: `¡Importación completada! Se han insertado ${payload.length} fichajes correctamente${
            skipped > 0 ? ` (${skipped} filas omitidas por fecha inválida)` : ''
          }.`,
        });
        onImportSuccess();
      } else {
        if (!colTempDate || !colTempValue) {
          setResultMsg({
            type: 'error',
            text: 'Debes mapear las columnas de Fecha y Temperatura.',
          });
          setImporting(false);
          return;
        }

        const payload: Array<{
          fridge_id: string;
          employee_id: string;
          temperature: number;
          recorded_at: string;
          corrective_action: string | null;
        }> = [];

        let skipped = 0;

        for (const row of rows) {
          const parsedIso = parseFlexibleDate(
            row[colTempDate],
            colTempTime ? row[colTempTime] : undefined
          );
          const rawTemp = String(row[colTempValue] ?? '')
            .replace(',', '.')
            .replace(/[^0-9.\-]/g, '');
          const tempNum = parseFloat(rawTemp);

          const fId = colFridge
            ? resolveFridgeId(row[colFridge])
            : fallbackFridgeId || fridges[0]?.id || null;

          if (!parsedIso || isNaN(tempNum) || !fId) {
            skipped++;
            continue;
          }

          const empId = colTempEmployee
            ? resolveEmployeeId(row[colTempEmployee])
            : fallbackEmployeeId || currentAdmin.id;

          const corrective =
            colCorrective && row[colCorrective]
              ? String(row[colCorrective]).trim()
              : null;

          payload.push({
            fridge_id: fId,
            employee_id: empId,
            temperature: tempNum,
            recorded_at: parsedIso,
            corrective_action: corrective,
          });
        }

        if (payload.length === 0) {
          setResultMsg({
            type: 'error',
            text: 'No se encontraron filas válidas (verifica que exista al menos una nevera creada y que las columnas de Temperatura y Fecha sean correctas).',
          });
          setImporting(false);
          return;
        }

        const batchSize = 200;
        for (let i = 0; i < payload.length; i += batchSize) {
          const chunk = payload.slice(i, i + batchSize);
          const { error } = await supabase
            .from('temperature_logs')
            .insert(chunk);
          if (error) throw error;
        }

        setResultMsg({
          type: 'success',
          text: `¡Importación APPCC completada! Se han insertado ${payload.length} registros de temperatura${
            skipped > 0 ? ` (${skipped} filas omitidas)` : ''
          }.`,
        });
        onImportSuccess();
      }
    } catch (err) {
      setResultMsg({
        type: 'error',
        text: `Error al volcar a Supabase: ${
          err instanceof Error ? err.message : 'Error desconocido'
        }`,
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <FileSpreadsheet className="w-6 h-6 text-blue-400" />
              Importador Visual de Histórico (Excel / CSV)
            </h3>
            <p className="text-slate-400 text-sm mt-1">
              Sube tus hojas de cálculo antiguas (.xlsx, .xls, .csv), asigna las
              columnas y vuelca los datos masivamente a Supabase.
            </p>
          </div>

          <div className="flex bg-slate-800 p-1.5 rounded-xl border border-slate-700">
            <button
              type="button"
              onClick={() => {
                setTarget('time_logs');
                setResultMsg(null);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                target === 'time_logs'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Histórico de Fichajes
            </button>
            <button
              type="button"
              onClick={() => {
                setTarget('temperature_logs');
                setResultMsg(null);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                target === 'temperature_logs'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Histórico Temperaturas APPCC
            </button>
          </div>
        </div>

        {/* Zona de subida de archivo */}
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-2xl p-8 cursor-pointer bg-slate-950/50 transition-all">
          <Upload className="w-10 h-10 text-blue-400 mb-3" />
          <span className="text-base font-semibold text-white">
            {fileName
              ? `Archivo cargado: ${fileName} (${rows.length} filas detectadas)`
              : 'Haz clic para seleccionar un archivo Excel (.xlsx, .xls) o CSV (.csv)'}
          </span>
          <span className="text-xs text-slate-400 mt-1">
            Soporta fechas en formato español (DD/MM/YYYY), fechas nativas de
            Excel e ISO
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {resultMsg && (
          <div
            className={`mt-5 p-4 rounded-xl border flex items-start gap-3 ${
              resultMsg.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200'
                : 'bg-red-950/60 border-red-500/50 text-red-200'
            }`}
          >
            {resultMsg.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            )}
            <span className="text-sm font-medium">{resultMsg.text}</span>
          </div>
        )}

        {/* Mapeador de columnas */}
        {headers.length > 0 && (
          <div className="mt-6 space-y-6">
            <div className="border-t border-slate-800 pt-6">
              <h4 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-blue-400" />
                Paso 2: Mapear columnas de tu archivo con Supabase
              </h4>

              {target === 'time_logs' ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Columna Fecha / Fecha-Hora *
                    </label>
                    <select
                      value={colDate}
                      onChange={(e) => setColDate(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      <option value="">-- Seleccionar columna --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Columna Hora (si está separada)
                    </label>
                    <select
                      value={colTime}
                      onChange={(e) => setColTime(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      <option value="">-- En la misma columna de Fecha --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Columna Tipo Fichaje (IN/OUT/Entrada/Salida)
                    </label>
                    <select
                      value={colType}
                      onChange={(e) => setColType(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      <option value="">-- Por defecto: Entrada (IN) --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Columna Empleado (Nombre o DNI)
                    </label>
                    <select
                      value={colEmployee}
                      onChange={(e) => setColEmployee(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      <option value="">-- Usar empleado por defecto --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Empleado por defecto (si no coincide)
                    </label>
                    <select
                      value={fallbackEmployeeId}
                      onChange={(e) => setFallbackEmployeeId(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.dni})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Columna Notas / Observaciones
                    </label>
                    <select
                      value={colNotes}
                      onChange={(e) => setColNotes(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      <option value="">-- Sin columna de notas --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Columna Fecha / Fecha-Hora *
                    </label>
                    <select
                      value={colTempDate}
                      onChange={(e) => setColTempDate(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      <option value="">-- Seleccionar columna --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Columna Hora (si está separada)
                    </label>
                    <select
                      value={colTempTime}
                      onChange={(e) => setColTempTime(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      <option value="">-- En la misma columna de Fecha --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Columna Temperatura (°C) *
                    </label>
                    <select
                      value={colTempValue}
                      onChange={(e) => setColTempValue(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      <option value="">-- Seleccionar columna --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Columna Nevera / Equipo
                    </label>
                    <select
                      value={colFridge}
                      onChange={(e) => setColFridge(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      <option value="">-- Usar nevera por defecto --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Nevera por defecto (si no coincide)
                    </label>
                    <select
                      value={fallbackFridgeId}
                      onChange={(e) => setFallbackFridgeId(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      {fridges.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} ({f.min_temp}°C a {f.max_temp}°C)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-1.5">
                      Columna Acción Correctora
                    </label>
                    <select
                      value={colCorrective}
                      onChange={(e) => setColCorrective(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm"
                    >
                      <option value="">-- Sin acción correctora --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Vista previa de las primeras 5 filas */}
            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                Vista previa del archivo ({Math.min(5, rows.length)} de{' '}
                {rows.length} filas)
              </h5>
              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-800/80 text-slate-200 uppercase">
                    <tr>
                      {headers.map((h) => (
                        <th key={h} className="px-3 py-2.5 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-slate-950/40">
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {headers.map((h) => (
                          <td key={h} className="px-3 py-2 whitespace-nowrap">
                            {String(r[h] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={importing}
                onClick={handleBulkImport}
                className="flex items-center gap-2 px-6 py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold shadow-lg shadow-blue-600/25 transition-all active:scale-95"
              >
                {importing ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Volcando datos a Supabase...</span>
                  </>
                ) : (
                  <>
                    <Database className="w-5 h-5" />
                    <span>
                      Importar {rows.length} registros a Supabase
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
