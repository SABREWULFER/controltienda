'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock,
  Thermometer,
  FileSpreadsheet,
  Users,
  Download,
  Edit3,
  Plus,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Snowflake,
  UserPlus,
  Save,
  X,
  Calendar,
  Filter,
} from 'lucide-react';
import { getSupabaseServerTimestamp, supabase } from '@/lib/supabase';
import {
  Employee,
  EmployeeRole,
  Fridge,
  TemperatureLog,
  TimeLog,
  TimeLogType,
} from '@/types/database';
import {
  calculateDailyWorkSummaries,
  formatDateTimeSpain,
  formatMinutesToHHMM,
  getMonthDateRangeISO,
  getTimeLogTypeLabel,
  isInMadridMonthYear,
  toMadridDateTimeLocalValue,
} from '@/lib/utils';
import {
  exportLaborInspectionExcel,
  exportSanidadAppccExcel,
} from '@/lib/excel-export';
import CsvExcelImporter from './CsvExcelImporter';

interface AdminPanelProps {
  currentAdmin: Employee;
  onExitAdmin: () => void;
  onDataUpdated: () => void;
}

type AdminTab = 'timelogs' | 'temperatures' | 'import' | 'management';

const MONTHS = [
  { value: 1, label: 'Enero' },
  { value: 2, label: 'Febrero' },
  { value: 3, label: 'Marzo' },
  { value: 4, label: 'Abril' },
  { value: 5, label: 'Mayo' },
  { value: 6, label: 'Junio' },
  { value: 7, label: 'Julio' },
  { value: 8, label: 'Agosto' },
  { value: 9, label: 'Septiembre' },
  { value: 10, label: 'Octubre' },
  { value: 11, label: 'Noviembre' },
  { value: 12, label: 'Diciembre' },
];

export default function AdminPanel({
  currentAdmin,
  onExitAdmin,
  onDataUpdated,
}: AdminPanelProps) {
  const now = new Date();
  const [activeTab, setActiveTab] = useState<AdminTab>('timelogs');
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(
    now.getMonth() + 1
  );

  // Filtros específicos
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('ALL');
  const [selectedFridgeId, setSelectedFridgeId] = useState<string>('ALL');

  // Datos cargados desde Supabase
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [fridges, setFridges] = useState<Fridge[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [tempLogs, setTempLogs] = useState<TemperatureLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Modal de Edición de Fichaje (Pestaña 1)
  const [editingLog, setEditingLog] = useState<TimeLog | null>(null);
  const [editType, setEditType] = useState<TimeLogType>('IN');
  const [editDateTime, setEditDateTime] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  // Modal de Nuevo Fichaje Manual (olvido de empleado, con constancia en edited_by)
  const [showNewLogModal, setShowNewLogModal] = useState<boolean>(false);
  const [newLogEmployeeId, setNewLogEmployeeId] = useState<string>('');
  const [newLogType, setNewLogType] = useState<TimeLogType>('IN');
  const [newLogDateTime, setNewLogDateTime] = useState<string>('');
  const [newLogNotes, setNewLogNotes] = useState<string>('');

  // Gestión de Empleados (Pestaña 4)
  const [empFormId, setEmpFormId] = useState<string | null>(null);
  const [empName, setEmpName] = useState<string>('');
  const [empDni, setEmpDni] = useState<string>('');
  const [empPin, setEmpPin] = useState<string>('');
  const [empRole, setEmpRole] = useState<EmployeeRole>('staff');
  const [empActive, setEmpActive] = useState<boolean>(true);
  const [savingEmp, setSavingEmp] = useState<boolean>(false);

  // Gestión de Neveras (Pestaña 4)
  const [fridgeFormId, setFridgeFormId] = useState<string | null>(null);
  const [fridgeName, setFridgeName] = useState<string>('');
  const [fridgeMin, setFridgeMin] = useState<string>('0');
  const [fridgeMax, setFridgeMax] = useState<string>('5');
  const [fridgeActive, setFridgeActive] = useState<boolean>(true);
  const [savingFridge, setSavingFridge] = useState<boolean>(false);

  const yearsList = useMemo(() => {
    const currentY = new Date().getFullYear();
    const arr: number[] = [];
    for (let y = currentY - 4; y <= currentY + 1; y++) {
      arr.push(y);
    }
    return arr;
  }, []);

  const fetchAdminData = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: empData }, { data: fridgeData }] = await Promise.all([
        supabase.from('employees').select('*').order('name', { ascending: true }),
        supabase.from('fridges').select('*').order('name', { ascending: true }),
      ]);

      const empList = (empData || []) as Employee[];
      const fridgeList = (fridgeData || []) as Fridge[];
      setEmployees(empList);
      setFridges(fridgeList);

      const empMap = new Map<string, Employee>(empList.map((e) => [e.id, e]));
      const fridgeMap = new Map<string, Fridge>(
        fridgeList.map((f) => [f.id, f])
      );

      const { startISO, endISO } = getMonthDateRangeISO(
        selectedYear,
        selectedMonth
      );

      const [{ data: tLogsData }, { data: tempLogsData }] = await Promise.all([
        supabase
          .from('time_logs')
          .select('*')
          .gte('timestamp', startISO)
          .lte('timestamp', endISO)
          .order('timestamp', { ascending: false }),
        supabase
          .from('temperature_logs')
          .select('*')
          .gte('recorded_at', startISO)
          .lte('recorded_at', endISO)
          .order('recorded_at', { ascending: false }),
      ]);

      // Filtrar exactamente en zona horaria Europe/Madrid y enriquecer relaciones
      const enrichedTimeLogs: TimeLog[] = ((tLogsData || []) as TimeLog[])
        .filter((l) =>
          isInMadridMonthYear(l.timestamp, selectedYear, selectedMonth)
        )
        .map((l) => ({
          ...l,
          employees: empMap.get(l.employee_id) || null,
        }));

      const enrichedTempLogs: TemperatureLog[] = (
        (tempLogsData || []) as TemperatureLog[]
      )
        .filter((t) =>
          isInMadridMonthYear(t.recorded_at, selectedYear, selectedMonth)
        )
        .map((t) => ({
          ...t,
          fridges: fridgeMap.get(t.fridge_id) || null,
          employees: empMap.get(t.employee_id) || null,
        }));

      setTimeLogs(enrichedTimeLogs);
      setTempLogs(enrichedTempLogs);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: `Error cargando datos: ${
          err instanceof Error ? err.message : 'Error de conexión'
        }`,
      });
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  // Fichajes filtrados por empleado
  const filteredTimeLogs = useMemo(() => {
    if (selectedEmployeeId === 'ALL') return timeLogs;
    return timeLogs.filter((l) => l.employee_id === selectedEmployeeId);
  }, [timeLogs, selectedEmployeeId]);

  // Resumen de jornadas calculadas
  const dailySummaries = useMemo(
    () => calculateDailyWorkSummaries(filteredTimeLogs),
    [filteredTimeLogs]
  );

  const totalMonthWorkedMinutes = useMemo(
    () => dailySummaries.reduce((acc, s) => acc + s.workedMinutes, 0),
    [dailySummaries]
  );

  // Temperaturas filtradas por nevera
  const filteredTempLogs = useMemo(() => {
    if (selectedFridgeId === 'ALL') return tempLogs;
    return tempLogs.filter((t) => t.fridge_id === selectedFridgeId);
  }, [tempLogs, selectedFridgeId]);

  const outOfRangeCount = useMemo(() => {
    return filteredTempLogs.filter((t) => {
      const f = t.fridges;
      if (!f) return false;
      return (
        Number(t.temperature) < Number(f.min_temp) ||
        Number(t.temperature) > Number(f.max_temp)
      );
    }).length;
  }, [filteredTempLogs]);

  // Abrir modal de edición de fichaje
  const openEditLogModal = (log: TimeLog) => {
    setEditingLog(log);
    setEditType(log.type);
    setEditDateTime(toMadridDateTimeLocalValue(log.timestamp));
    setEditNotes(log.notes || '');
  };

  // Guardar edición de fichaje (dejando constancia en edited_by y edited_at)
  const handleSaveLogEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLog || !editDateTime) return;

    setSavingEdit(true);
    setFeedback(null);
    try {
      const parsedDate = new Date(editDateTime);
      if (isNaN(parsedDate.getTime())) {
        throw new Error('La fecha y hora introducidas no son válidas.');
      }

      const serverNow = await getSupabaseServerTimestamp();
      const editorLabel = `${currentAdmin.name} (${currentAdmin.dni})`;

      const { error } = await supabase
        .from('time_logs')
        .update({
          type: editType,
          timestamp: parsedDate.toISOString(),
          notes: editNotes.trim() || null,
          edited_by: editorLabel,
          edited_at: serverNow,
        })
        .eq('id', editingLog.id);

      if (error) throw error;

      setFeedback({
        type: 'success',
        text: `Fichaje actualizado. Constancia de auditoría registrada (${editorLabel}).`,
      });
      setEditingLog(null);
      await fetchAdminData();
      onDataUpdated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: `No se pudo actualizar el fichaje: ${
          err instanceof Error ? err.message : 'Error desconocido'
        }`,
      });
    } finally {
      setSavingEdit(false);
    }
  };

  // Crear fichaje manual (con auditoría)
  const handleCreateManualLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLogEmployeeId || !newLogDateTime) return;
    setSavingEdit(true);
    setFeedback(null);

    try {
      const parsedDate = new Date(newLogDateTime);
      if (isNaN(parsedDate.getTime())) {
        throw new Error('Fecha u hora inválida.');
      }

      const serverNow = await getSupabaseServerTimestamp();
      const editorLabel = `${currentAdmin.name} (${currentAdmin.dni})`;

      const { error } = await supabase.from('time_logs').insert({
        employee_id: newLogEmployeeId,
        type: newLogType,
        timestamp: parsedDate.toISOString(),
        notes: newLogNotes.trim() || 'Registro manual por administración',
        edited_by: editorLabel,
        edited_at: serverNow,
      });

      if (error) throw error;

      setFeedback({
        type: 'success',
        text: 'Fichaje manual añadido con trazabilidad de auditoría.',
      });
      setShowNewLogModal(false);
      setNewLogNotes('');
      await fetchAdminData();
      onDataUpdated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: `Error al añadir fichaje: ${
          err instanceof Error ? err.message : 'Error desconocido'
        }`,
      });
    } finally {
      setSavingEdit(false);
    }
  };

  // Guardar Empleado (Crear o Editar)
  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPin = empPin.trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      setFeedback({
        type: 'error',
        text: 'El código PIN debe tener exactamente 4 dígitos numéricos.',
      });
      return;
    }

    // Verificar que ningún otro empleado tenga el mismo PIN
    const duplicatePin = employees.find(
      (emp) => emp.pin_code === cleanPin && emp.id !== empFormId
    );
    if (duplicatePin) {
      setFeedback({
        type: 'error',
        text: `El PIN ${cleanPin} ya está asignado a ${duplicatePin.name}. Usa otro PIN de 4 dígitos.`,
      });
      return;
    }

    setSavingEmp(true);
    setFeedback(null);
    try {
      if (empFormId) {
        const { error } = await supabase
          .from('employees')
          .update({
            name: empName.trim(),
            dni: empDni.trim().toUpperCase(),
            pin_code: cleanPin,
            role: empRole,
            active: empActive,
          })
          .eq('id', empFormId);
        if (error) throw error;
        setFeedback({
          type: 'success',
          text: `Empleado "${empName}" actualizado correctamente.`,
        });
      } else {
        const { error } = await supabase.from('employees').insert({
          name: empName.trim(),
          dni: empDni.trim().toUpperCase(),
          pin_code: cleanPin,
          role: empRole,
          active: empActive,
        });
        if (error) throw error;
        setFeedback({
          type: 'success',
          text: `Empleado "${empName}" creado correctamente.`,
        });
      }

      setEmpFormId(null);
      setEmpName('');
      setEmpDni('');
      setEmpPin('');
      setEmpRole('staff');
      setEmpActive(true);
      await fetchAdminData();
      onDataUpdated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: `Error al guardar empleado: ${
          err instanceof Error ? err.message : 'Error desconocido'
        }`,
      });
    } finally {
      setSavingEmp(false);
    }
  };

  const handleToggleEmployeeActive = async (emp: Employee) => {
    try {
      const { error } = await supabase
        .from('employees')
        .update({ active: !emp.active })
        .eq('id', emp.id);
      if (error) throw error;
      await fetchAdminData();
      onDataUpdated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: `Error al cambiar estado del empleado: ${
          err instanceof Error ? err.message : 'Error'
        }`,
      });
    }
  };

  // Guardar Nevera (Crear o Editar)
  const handleSaveFridge = async (e: React.FormEvent) => {
    e.preventDefault();
    const minVal = parseFloat(fridgeMin.replace(',', '.'));
    const maxVal = parseFloat(fridgeMax.replace(',', '.'));
    if (isNaN(minVal) || isNaN(maxVal) || minVal >= maxVal) {
      setFeedback({
        type: 'error',
        text: 'Rango térmico inválido: la temperatura mínima debe ser menor que la máxima.',
      });
      return;
    }

    setSavingFridge(true);
    setFeedback(null);
    try {
      if (fridgeFormId) {
        const { error } = await supabase
          .from('fridges')
          .update({
            name: fridgeName.trim(),
            min_temp: minVal,
            max_temp: maxVal,
            active: fridgeActive,
          })
          .eq('id', fridgeFormId);
        if (error) throw error;
        setFeedback({
          type: 'success',
          text: `Nevera "${fridgeName}" actualizada correctamente.`,
        });
      } else {
        const { error } = await supabase.from('fridges').insert({
          name: fridgeName.trim(),
          min_temp: minVal,
          max_temp: maxVal,
          active: fridgeActive,
        });
        if (error) throw error;
        setFeedback({
          type: 'success',
          text: `Nevera "${fridgeName}" creada correctamente.`,
        });
      }

      setFridgeFormId(null);
      setFridgeName('');
      setFridgeMin('0');
      setFridgeMax('5');
      setFridgeActive(true);
      await fetchAdminData();
      onDataUpdated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: `Error al guardar nevera: ${
          err instanceof Error ? err.message : 'Error desconocido'
        }`,
      });
    } finally {
      setSavingFridge(false);
    }
  };

  const handleToggleFridgeActive = async (fridge: Fridge) => {
    try {
      const { error } = await supabase
        .from('fridges')
        .update({ active: !fridge.active })
        .eq('id', fridge.id);
      if (error) throw error;
      await fetchAdminData();
      onDataUpdated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: `Error al cambiar estado de la nevera: ${
          err instanceof Error ? err.message : 'Error'
        }`,
      });
    }
  };

  const selectedEmployeeObj = employees.find(
    (e) => e.id === selectedEmployeeId
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Cabecera Superior de Administración */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onExitAdmin}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition-all active:scale-95"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Volver al Kiosco</span>
            </button>
            <div>
              <h1 className="text-xl font-extrabold text-white tracking-tight">
                Panel de Administración y Cumplimiento Legal
              </h1>
              <p className="text-xs text-slate-400">
                Sesión Admin: <strong className="text-slate-200">{currentAdmin.name}</strong> ({currentAdmin.dni}) · Zona horaria oficial: Europe/Madrid
              </p>
            </div>
          </div>

          {/* Selector Global de Mes/Año + Botones Destacados de Exportación Excel */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-2 rounded-xl">
              <Calendar className="w-4 h-4 text-blue-400" />
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="bg-transparent text-sm font-bold text-white focus:outline-none cursor-pointer"
              >
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value} className="bg-slate-900">
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="bg-transparent text-sm font-bold text-white focus:outline-none cursor-pointer"
              >
                {yearsList.map((y) => (
                  <option key={y} value={y} className="bg-slate-900">
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() =>
                exportLaborInspectionExcel(
                  filteredTimeLogs,
                  selectedYear,
                  selectedMonth,
                  selectedEmployeeObj?.name
                )
              }
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold shadow-lg shadow-blue-600/20 transition-all active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>Exportar Excel Inspección Trabajo</span>
            </button>

            <button
              type="button"
              onClick={() =>
                exportSanidadAppccExcel(
                  filteredTempLogs,
                  selectedYear,
                  selectedMonth
                )
              }
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold shadow-lg shadow-emerald-600/20 transition-all active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>Exportar Excel Sanidad (APPCC)</span>
            </button>
          </div>
        </div>

        {/* Barra de Navegación por Pestañas */}
        <div className="max-w-7xl mx-auto mt-4 flex flex-wrap gap-2 border-t border-slate-800/80 pt-3">
          <button
            type="button"
            onClick={() => setActiveTab('timelogs')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'timelogs'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>1. Registros de Fichajes</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('temperatures')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'temperatures'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Thermometer className="w-4 h-4" />
            <span>2. Registros de Temperaturas</span>
            {outOfRangeCount > 0 && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-red-600 text-white font-extrabold">
                {outOfRangeCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'import'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>3. Importar Histórico Excel/CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('management')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
              activeTab === 'management'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>4. Empleados y Neveras</span>
          </button>

          <button
            type="button"
            onClick={fetchAdminData}
            className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
            title="Recargar datos de Supabase"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="max-w-7xl w-full mx-auto p-6 flex-1 space-y-6">
        {feedback && (
          <div
            className={`p-4 rounded-xl border flex items-center justify-between ${
              feedback.type === 'success'
                ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200'
                : 'bg-red-950/70 border-red-500/50 text-red-200'
            }`}
          >
            <div className="flex items-center gap-3">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              )}
              <span className="text-sm font-medium">{feedback.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* PESTAÑA 1: REGISTROS DE FICHAJES */}
        {activeTab === 'timelogs' && (
          <div className="space-y-6">
            {/* Barra de Filtros y Resumen */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
                <label className="text-xs font-bold uppercase text-slate-400 flex items-center gap-1.5 mb-2">
                  <Filter className="w-3.5 h-3.5 text-blue-400" />
                  Filtrar por Empleado
                </label>
                <select
                  value={selectedEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-semibold text-sm"
                >
                  <option value="ALL">Todos los empleados ({employees.length})</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.dni}) {!emp.active ? '[Inactivo]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <span className="text-xs font-bold uppercase text-slate-400">
                  Total Horas Trabajadas (Mes)
                </span>
                <p className="text-2xl font-extrabold text-blue-400 mt-1">
                  {formatMinutesToHHMM(totalMonthWorkedMinutes)}
                </p>
                <span className="text-xs text-slate-500">
                  {(totalMonthWorkedMinutes / 60).toFixed(2)} horas decimales
                </span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <span className="text-xs font-bold uppercase text-slate-400">
                  Jornadas / Marcajes
                </span>
                <p className="text-2xl font-extrabold text-white mt-1">
                  {dailySummaries.length} días · {filteredTimeLogs.length} fichajes
                </p>
                <span className="text-xs text-slate-500">
                  Periodo {String(selectedMonth).padStart(2, '0')}/{selectedYear}
                </span>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between">
                <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>Inspección Trabajo (RDL 8/2019)</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewLogEmployeeId(
                      selectedEmployeeId !== 'ALL'
                        ? selectedEmployeeId
                        : employees[0]?.id || ''
                    );
                    setNewLogDateTime(
                      toMadridDateTimeLocalValue(new Date().toISOString())
                    );
                    setShowNewLogModal(true);
                  }}
                  className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-xs font-bold transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Añadir Fichaje Olvidado (Auditado)</span>
                </button>
              </div>
            </div>

            {/* Tabla Resumen por Jornada (Cálculo de horas trabajadas por jornada) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Resumen de Horas Trabajadas por Jornada
                  </h2>
                  <p className="text-xs text-slate-400">
                    Cálculo automático descontando pausas en horario oficial Europe/Madrid
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950/70 text-slate-400 text-xs uppercase">
                    <tr>
                      <th className="px-5 py-3">Fecha</th>
                      <th className="px-5 py-3">Empleado</th>
                      <th className="px-5 py-3">DNI</th>
                      <th className="px-5 py-3">1ª Entrada</th>
                      <th className="px-5 py-3">Última Salida</th>
                      <th className="px-5 py-3">Pausas</th>
                      <th className="px-5 py-3">Horas Trabajadas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {dailySummaries.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-5 py-6 text-center text-slate-500"
                        >
                          No hay jornadas registradas para este filtro en{' '}
                          {MONTHS[selectedMonth - 1]?.label} {selectedYear}.
                        </td>
                      </tr>
                    ) : (
                      dailySummaries.map((s) => (
                        <tr
                          key={`${s.employeeId}_${s.dateKey}`}
                          className="hover:bg-slate-800/40"
                        >
                          <td className="px-5 py-3 font-semibold text-white">
                            {s.dateKey}
                          </td>
                          <td className="px-5 py-3 text-slate-200">
                            {s.employeeName}
                          </td>
                          <td className="px-5 py-3 text-slate-400 font-mono text-xs">
                            {s.employeeDni}
                          </td>
                          <td className="px-5 py-3 text-emerald-400 font-mono">
                            {s.firstIn || '-'}
                          </td>
                          <td className="px-5 py-3 text-rose-400 font-mono">
                            {s.lastOut || 'En curso / Sin salida'}
                          </td>
                          <td className="px-5 py-3 text-amber-300">
                            {s.pauseMinutes} min
                          </td>
                          <td className="px-5 py-3 font-extrabold text-blue-400">
                            {s.workedFormatted} ({s.workedDecimalHours}h)
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tabla Detallada de Fichajes (Con Edición Auditada, Sin Borrado) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Detalle Íntegro de Fichajes (Inalterable frente a borrado)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Por normativa de Inspección de Trabajo los registros no pueden eliminarse. Cualquier corrección registra autor y fecha en edited_by y edited_at.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950/70 text-slate-400 text-xs uppercase">
                    <tr>
                      <th className="px-5 py-3.5">Fecha y Hora (Madrid)</th>
                      <th className="px-5 py-3.5">Empleado</th>
                      <th className="px-5 py-3.5">Tipo</th>
                      <th className="px-5 py-3.5">Notas</th>
                      <th className="px-5 py-3.5">Trazabilidad / Auditoría</th>
                      <th className="px-5 py-3.5 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredTimeLogs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-5 py-8 text-center text-slate-500"
                        >
                          No se encontraron fichajes en este mes.
                        </td>
                      </tr>
                    ) : (
                      filteredTimeLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-800/40">
                          <td className="px-5 py-3.5 font-mono text-white whitespace-nowrap">
                            {formatDateTimeSpain(log.timestamp)}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="font-semibold text-slate-200">
                              {log.employees?.name || 'Desconocido'}
                            </div>
                            <div className="text-xs text-slate-400 font-mono">
                              {log.employees?.dni || '-'}
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${
                                log.type === 'IN'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : log.type === 'OUT'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {getTimeLogTypeLabel(log.type)}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-slate-300 max-w-xs">
                            {log.notes || '-'}
                          </td>
                          <td className="px-5 py-3.5 text-xs">
                            {log.edited_by ? (
                              <div className="text-amber-300">
                                <span className="font-semibold">
                                  Editado por: {log.edited_by}
                                </span>
                                <br />
                                <span className="text-slate-400">
                                  Fecha: {formatDateTimeSpain(log.edited_at)}
                                </span>
                              </div>
                            ) : (
                              <span className="text-emerald-400/80 font-medium">
                                Original (Servidor)
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => openEditLogModal(log)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white text-xs font-semibold transition-all"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Corregir</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* PESTAÑA 2: REGISTROS DE TEMPERATURAS (APPCC SANIDAD) */}
        {activeTab === 'temperatures' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <label className="text-xs font-bold uppercase text-slate-400 flex items-center gap-1.5 mb-2">
                  <Snowflake className="w-3.5 h-3.5 text-cyan-400" />
                  Filtrar por Nevera / Equipo
                </label>
                <select
                  value={selectedFridgeId}
                  onChange={(e) => setSelectedFridgeId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-white font-semibold text-sm"
                >
                  <option value="ALL">Todas las neveras ({fridges.length})</option>
                  {fridges.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.min_temp}°C a {f.max_temp}°C)
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <span className="text-xs font-bold uppercase text-slate-400">
                  Total Lecturas Registradas
                </span>
                <p className="text-2xl font-extrabold text-white mt-1">
                  {filteredTempLogs.length} controles
                </p>
                <span className="text-xs text-slate-500">
                  Mes {String(selectedMonth).padStart(2, '0')}/{selectedYear}
                </span>
              </div>

              <div
                className={`border rounded-2xl p-4 ${
                  outOfRangeCount > 0
                    ? 'bg-red-950/40 border-red-500/50'
                    : 'bg-emerald-950/30 border-emerald-500/30'
                }`}
              >
                <span className="text-xs font-bold uppercase text-slate-300">
                  Incidencias Fuera de Rango
                </span>
                <p
                  className={`text-2xl font-extrabold mt-1 ${
                    outOfRangeCount > 0 ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {outOfRangeCount} lecturas críticas
                </p>
                <span className="text-xs text-slate-400">
                  Resaltadas en rojo con su acción correctora APPCC
                </span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800">
                <h2 className="text-base font-bold text-white">
                  Registro Oficial de Temperaturas APPCC (Inspección de Sanidad)
                </h2>
                <p className="text-xs text-slate-400">
                  Las lecturas fuera del rango permitido [min_temp, max_temp] se resaltan automáticamente en rojo junto a la acción correctora aplicada.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950/70 text-slate-400 text-xs uppercase">
                    <tr>
                      <th className="px-5 py-3.5">Fecha y Hora (Madrid)</th>
                      <th className="px-5 py-3.5">Nevera / Equipo</th>
                      <th className="px-5 py-3.5">Rango Permitido</th>
                      <th className="px-5 py-3.5">Temperatura</th>
                      <th className="px-5 py-3.5">Estado APPCC</th>
                      <th className="px-5 py-3.5">Acción Correctora Tomada</th>
                      <th className="px-5 py-3.5">Operario</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredTempLogs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-5 py-8 text-center text-slate-500"
                        >
                          No hay lecturas de temperatura registradas en este periodo.
                        </td>
                      </tr>
                    ) : (
                      filteredTempLogs.map((t) => {
                        const min = t.fridges?.min_temp;
                        const max = t.fridges?.max_temp;
                        const tempVal = Number(t.temperature);
                        const hasRange =
                          min !== undefined &&
                          max !== undefined &&
                          min !== null &&
                          max !== null;
                        const isOut = hasRange
                          ? tempVal < Number(min) || tempVal > Number(max)
                          : false;

                        return (
                          <tr
                            key={t.id}
                            className={
                              isOut
                                ? 'bg-red-950/60 hover:bg-red-950/80 text-red-100'
                                : 'hover:bg-slate-800/40'
                            }
                          >
                            <td className="px-5 py-3.5 font-mono whitespace-nowrap">
                              {formatDateTimeSpain(t.recorded_at)}
                            </td>
                            <td className="px-5 py-3.5 font-bold">
                              {t.fridges?.name || 'Equipo'}
                            </td>
                            <td className="px-5 py-3.5 font-mono text-xs text-slate-300">
                              {hasRange ? `${min}°C a ${max}°C` : '-'}
                            </td>
                            <td className="px-5 py-3.5">
                              <span
                                className={`text-base font-extrabold font-mono ${
                                  isOut ? 'text-red-400' : 'text-emerald-400'
                                }`}
                              >
                                {tempVal.toFixed(1)} °C
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              {isOut ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-600 text-white text-xs font-extrabold">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  FUERA DE RANGO
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  CORRECTO
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3.5">
                              {t.corrective_action ? (
                                <span
                                  className={`font-semibold ${
                                    isOut ? 'text-red-200' : 'text-slate-300'
                                  }`}
                                >
                                  {t.corrective_action}
                                </span>
                              ) : (
                                <span className="text-slate-500">-</span>
                              )}
                            </td>
                            <td className="px-5 py-3.5 text-slate-300">
                              {t.employees?.name || '-'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* PESTAÑA 3: IMPORTAR HISTÓRICO DESDE EXCEL/CSV */}
        {activeTab === 'import' && (
          <CsvExcelImporter
            employees={employees}
            fridges={fridges}
            currentAdmin={currentAdmin}
            onImportSuccess={() => {
              fetchAdminData();
              onDataUpdated();
            }}
          />
        )}

        {/* PESTAÑA 4: GESTIÓN DE EMPLEADOS Y NEVERAS */}
        {activeTab === 'management' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Columna Izquierda: Gestión de Empleados */}
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                  <UserPlus className="w-5 h-5 text-blue-400" />
                  {empFormId ? 'Editar Empleado' : 'Nuevo Empleado'}
                </h2>

                <form onSubmit={handleSaveEmployee} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                        Nombre Completo *
                      </label>
                      <input
                        type="text"
                        required
                        value={empName}
                        onChange={(e) => setEmpName(e.target.value)}
                        placeholder="Ej. Laura Gómez"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                        DNI / NIE *
                      </label>
                      <input
                        type="text"
                        required
                        value={empDni}
                        onChange={(e) => setEmpDni(e.target.value)}
                        placeholder="Ej. 12345678A"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm uppercase"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                        PIN (4 dígitos) *
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={4}
                        pattern="\d{4}"
                        value={empPin}
                        onChange={(e) =>
                          setEmpPin(e.target.value.replace(/\D/g, '').slice(0, 4))
                        }
                        placeholder="1234"
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-base tracking-widest"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                        Rol *
                      </label>
                      <select
                        value={empRole}
                        onChange={(e) =>
                          setEmpRole(e.target.value as EmployeeRole)
                        }
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm"
                      >
                        <option value="staff">Empleado (staff)</option>
                        <option value="admin">Administrador (admin)</option>
                      </select>
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-2 cursor-pointer bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 w-full">
                        <input
                          type="checkbox"
                          checked={empActive}
                          onChange={(e) => setEmpActive(e.target.checked)}
                          className="w-4 h-4 accent-blue-600"
                        />
                        <span className="text-sm font-semibold text-slate-200">
                          Activo
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    {empFormId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEmpFormId(null);
                          setEmpName('');
                          setEmpDni('');
                          setEmpPin('');
                          setEmpRole('staff');
                          setEmpActive(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-sm font-semibold"
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={savingEmp}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold shadow"
                    >
                      <Save className="w-4 h-4" />
                      <span>
                        {empFormId ? 'Guardar Cambios' : 'Crear Empleado'}
                      </span>
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-800">
                  <h3 className="text-base font-bold text-white">
                    Plantilla de Empleados ({employees.length})
                  </h3>
                </div>
                <div className="divide-y divide-slate-800">
                  {employees.map((emp) => (
                    <div
                      key={emp.id}
                      className="p-4 flex items-center justify-between gap-4 hover:bg-slate-800/40"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">
                            {emp.name}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-md font-bold uppercase ${
                              emp.role === 'admin'
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {emp.role}
                          </span>
                          {!emp.active && (
                            <span className="text-xs px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 font-bold">
                              Inactivo
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 font-mono">
                          DNI: {emp.dni} · PIN: <strong className="text-blue-400">{emp.pin_code}</strong>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEmpFormId(emp.id);
                            setEmpName(emp.name);
                            setEmpDni(emp.dni);
                            setEmpPin(emp.pin_code);
                            setEmpRole(emp.role);
                            setEmpActive(emp.active);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200"
                        >
                          Editar PIN / Datos
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleEmployeeActive(emp)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                            emp.active
                              ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300'
                              : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300'
                          }`}
                        >
                          {emp.active ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Columna Derecha: Gestión de Neveras */}
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                  <Snowflake className="w-5 h-5 text-cyan-400" />
                  {fridgeFormId
                    ? 'Editar Nevera / Equipo Frigorífico'
                    : 'Nueva Nevera / Equipo Frigorífico'}
                </h2>

                <form onSubmit={handleSaveFridge} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                      Nombre de la Nevera / Cámara *
                    </label>
                    <input
                      type="text"
                      required
                      value={fridgeName}
                      onChange={(e) => setFridgeName(e.target.value)}
                      placeholder="Ej. Cámara Refrigeración Lácteos 1"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                        Temp. Mínima (°C) *
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        required
                        value={fridgeMin}
                        onChange={(e) => setFridgeMin(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                        Temp. Máxima (°C) *
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        required
                        value={fridgeMax}
                        onChange={(e) => setFridgeMax(e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-sm"
                      />
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-2 cursor-pointer bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 w-full">
                        <input
                          type="checkbox"
                          checked={fridgeActive}
                          onChange={(e) => setFridgeActive(e.target.checked)}
                          className="w-4 h-4 accent-cyan-500"
                        />
                        <span className="text-sm font-semibold text-slate-200">
                          Activa
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    {fridgeFormId && (
                      <button
                        type="button"
                        onClick={() => {
                          setFridgeFormId(null);
                          setFridgeName('');
                          setFridgeMin('0');
                          setFridgeMax('5');
                          setFridgeActive(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-sm font-semibold"
                      >
                        Cancelar
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={savingFridge}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold shadow"
                    >
                      <Save className="w-4 h-4" />
                      <span>
                        {fridgeFormId ? 'Guardar Cambios' : 'Crear Nevera'}
                      </span>
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-800">
                  <h3 className="text-base font-bold text-white">
                    Equipos Frigoríficos Configurados ({fridges.length})
                  </h3>
                </div>
                <div className="divide-y divide-slate-800">
                  {fridges.length === 0 ? (
                    <div className="p-6 text-center text-slate-500 text-sm">
                      No hay neveras creadas todavía. Crea una arriba.
                    </div>
                  ) : (
                    fridges.map((f) => (
                      <div
                        key={f.id}
                        className="p-4 flex items-center justify-between gap-4 hover:bg-slate-800/40"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">
                              {f.name}
                            </span>
                            {!f.active && (
                              <span className="text-xs px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 font-bold">
                                Inactiva
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-cyan-400 font-mono mt-1">
                            Rango APPCC permitido: [{f.min_temp} °C a {f.max_temp} °C]
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setFridgeFormId(f.id);
                              setFridgeName(f.name);
                              setFridgeMin(String(f.min_temp));
                              setFridgeMax(String(f.max_temp));
                              setFridgeActive(f.active);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleFridgeActive(f)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                              f.active
                                ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300'
                                : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300'
                            }`}
                          >
                            {f.active ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal de Edición Auditada de Fichaje */}
      {editingLog && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-blue-400" />
                Corregir Registro de Fichaje
              </h3>
              <button
                type="button"
                onClick={() => setEditingLog(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-amber-950/50 border border-amber-500/40 rounded-xl p-3 text-xs text-amber-200">
              Esta modificación dejará constancia permanente en{' '}
              <strong>edited_by</strong> ({currentAdmin.name}) y{' '}
              <strong>edited_at</strong>.
            </div>

            <form onSubmit={handleSaveLogEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                  Empleado
                </label>
                <input
                  type="text"
                  disabled
                  value={editingLog.employees?.name || editingLog.employee_id}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-slate-400 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                  Tipo de Fichaje *
                </label>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as TimeLogType)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm font-semibold"
                >
                  <option value="IN">Entrada (IN)</option>
                  <option value="PAUSE_START">Iniciar Pausa (PAUSE_START)</option>
                  <option value="PAUSE_END">Fin Pausa (PAUSE_END)</option>
                  <option value="OUT">Salida (OUT)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                  Fecha y Hora *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={editDateTime}
                  onChange={(e) => setEditDateTime(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                  Motivo de la corrección / Notas *
                </label>
                <textarea
                  rows={2}
                  required
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Indica el motivo de la corrección para la Inspección..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-white text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingLog(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-sm font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold"
                >
                  {savingEdit ? 'Guardando...' : 'Guardar con Auditoría'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Nuevo Fichaje Manual (Olvido) */}
      {showNewLogModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-400" />
                Añadir Fichaje Manual (Auditado)
              </h3>
              <button
                type="button"
                onClick={() => setShowNewLogModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateManualLog} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                  Empleado *
                </label>
                <select
                  required
                  value={newLogEmployeeId}
                  onChange={(e) => setNewLogEmployeeId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm"
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.dni})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                  Tipo de Fichaje *
                </label>
                <select
                  value={newLogType}
                  onChange={(e) => setNewLogType(e.target.value as TimeLogType)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm font-semibold"
                >
                  <option value="IN">Entrada (IN)</option>
                  <option value="PAUSE_START">Iniciar Pausa (PAUSE_START)</option>
                  <option value="PAUSE_END">Fin Pausa (PAUSE_END)</option>
                  <option value="OUT">Salida (OUT)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                  Fecha y Hora *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={newLogDateTime}
                  onChange={(e) => setNewLogDateTime(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-400 mb-1">
                  Motivo / Observaciones *
                </label>
                <textarea
                  rows={2}
                  required
                  value={newLogNotes}
                  onChange={(e) => setNewLogNotes(e.target.value)}
                  placeholder="Ej. Olvido de fichaje de salida comunicado al responsable"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-white text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewLogModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-sm font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold"
                >
                  {savingEdit ? 'Guardando...' : 'Registrar Fichaje'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
