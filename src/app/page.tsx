'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Clock,
  Thermometer,
  ShieldCheck,
  Delete,
  LogIn,
  LogOut,
  Coffee,
  Play,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Snowflake,
  Settings,
  UserCheck,
  Sparkles,
} from 'lucide-react';
import { getSupabaseServerTimestamp, supabase } from '@/lib/supabase';
import {
  Employee,
  EmployeeWorkStatus,
  Fridge,
  TimeLog,
  TimeLogType,
} from '@/types/database';
import {
  formatDateTimeSpain,
  getEmployeeStatusFromLastLog,
  getStatusLabel,
  getTimeLogTypeLabel,
} from '@/lib/utils';
import PwaRegister from '@/components/PwaRegister';
import AdminPanel from '@/components/AdminPanel';

type KioskStep = 'PIN' | 'DASHBOARD' | 'FICHAR' | 'TEMPERATURAS' | 'SUCCESS' | 'ADMIN';

export default function KioskHomePage() {
  const [step, setStep] = useState<KioskStep>('PIN');
  const [pin, setPin] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [validatingPin, setValidatingPin] = useState<boolean>(false);

  // Reloj en tiempo real (Europe/Madrid)
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('');
  const [currentDateStr, setCurrentDateStr] = useState<string>('');

  // Empleado autenticado en el kiosco
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(null);
  const [workStatus, setWorkStatus] = useState<EmployeeWorkStatus>('OUTSIDE');
  const [lastLog, setLastLog] = useState<TimeLog | null>(null);
  const [fichajeNote, setFichajeNote] = useState<string>('');
  const [submittingAction, setSubmittingAction] = useState<boolean>(false);

  // Registro de Temperaturas APPCC
  const [activeFridges, setActiveFridges] = useState<Fridge[]>([]);
  const [tempValues, setTempValues] = useState<Record<string, string>>({});
  const [correctiveActions, setCorrectiveActions] = useState<
    Record<string, string>
  >({});
  const [tempError, setTempError] = useState<string | null>(null);

  // Pantalla de confirmación visual (3 segundos y retorno automático al PIN)
  const [successInfo, setSuccessInfo] = useState<{
    title: string;
    subtitle: string;
    timestamp: string;
  } | null>(null);
  const [countdown, setCountdown] = useState<number>(3);

  // Actualizar reloj cada segundo en zona Europe/Madrid
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTimeStr(
        new Intl.DateTimeFormat('es-ES', {
          timeZone: 'Europe/Madrid',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(now)
      );
      setCurrentDateStr(
        new Intl.DateTimeFormat('es-ES', {
          timeZone: 'Europe/Madrid',
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }).format(now)
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // Resetear al teclado PIN
  const resetToPinScreen = useCallback(() => {
    setStep('PIN');
    setPin('');
    setPinError(null);
    setCurrentEmployee(null);
    setLastLog(null);
    setFichajeNote('');
    setTempValues({});
    setCorrectiveActions({});
    setTempError(null);
    setSuccessInfo(null);
  }, []);

  // Temporizador de 3 segundos en la pantalla de confirmación visual
  useEffect(() => {
    if (step !== 'SUCCESS') return;
    setCountdown(3);

    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);

    const timeout = setTimeout(() => {
      resetToPinScreen();
    }, 3000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [step, resetToPinScreen]);

  // Validar PIN contra Supabase (y asegurar que el PIN admin inicial 1234 exista si la tabla está vacía)
  const validateEmployeePin = useCallback(async (enteredPin: string) => {
    setValidatingPin(true);
    setPinError(null);

    try {
      const { data: matchedEmployees, error } = await supabase
        .from('employees')
        .select('*')
        .eq('pin_code', enteredPin)
        .eq('active', true)
        .limit(1);

      if (error) throw error;

      let emp: Employee | null =
        matchedEmployees && matchedEmployees.length > 0
          ? (matchedEmployees[0] as Employee)
          : null;

      // Si introduce el PIN admin inicial 1234 y no existe aún en la base de datos, inicializarlo automáticamente
      if (!emp && enteredPin === '1234') {
        const { count } = await supabase
          .from('employees')
          .select('*', { count: 'exact', head: true });

        if (!count || count === 0) {
          const { data: createdAdmin, error: createErr } = await supabase
            .from('employees')
            .insert({
              name: 'Administrador Tienda',
              dni: '00000000A',
              pin_code: '1234',
              role: 'admin',
              active: true,
            })
            .select('*')
            .single();

          if (!createErr && createdAdmin) {
            emp = createdAdmin as Employee;
          }
        }
      }

      if (!emp) {
        setPinError('PIN incorrecto o empleado inactivo');
        setPin('');
        setValidatingPin(false);
        return;
      }

      // Consultar último fichaje del empleado y neveras activas en paralelo
      const [{ data: logsData }, { data: fridgesData }] = await Promise.all([
        supabase
          .from('time_logs')
          .select('*')
          .eq('employee_id', emp.id)
          .order('timestamp', { ascending: false })
          .limit(1),
        supabase
          .from('fridges')
          .select('*')
          .eq('active', true)
          .order('name', { ascending: true }),
      ]);

      const latestLog =
        logsData && logsData.length > 0 ? (logsData[0] as TimeLog) : null;
      const computedStatus = getEmployeeStatusFromLastLog(latestLog);

      setCurrentEmployee(emp);
      setLastLog(latestLog);
      setWorkStatus(computedStatus);
      setActiveFridges((fridgesData || []) as Fridge[]);
      setStep('DASHBOARD');
    } catch (err) {
      setPinError(
        `Error de conexión con Supabase: ${
          err instanceof Error ? err.message : 'Verifica la red'
        }`
      );
      setPin('');
    } finally {
      setValidatingPin(false);
    }
  }, []);

  // Auto-validar cuando se alcanzan los 4 dígitos
  useEffect(() => {
    if (pin.length === 4 && step === 'PIN' && !validatingPin) {
      validateEmployeePin(pin);
    }
  }, [pin, step, validatingPin, validateEmployeePin]);

  // Soporte también para teclado físico numérico en modo Kiosco PC
  useEffect(() => {
    if (step !== 'PIN') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (validatingPin) return;
      if (/^\d$/.test(e.key)) {
        setPinError(null);
        setPin((prev) => (prev.length < 4 ? prev + e.key : prev));
      } else if (e.key === 'Backspace') {
        setPinError(null);
        setPin((prev) => prev.slice(0, -1));
      } else if (e.key === 'Escape') {
        setPinError(null);
        setPin('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, validatingPin]);

  const handleDigitPress = (digit: string) => {
    if (pin.length >= 4 || validatingPin) return;
    setPinError(null);
    setPin((prev) => prev + digit);
  };

  const handleBackspace = () => {
    if (validatingPin) return;
    setPinError(null);
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClearPin = () => {
    if (validatingPin) return;
    setPinError(null);
    setPin('');
  };

  // Guardar fichaje en time_logs usando la hora del servidor de Supabase
  const handleClockAction = async (type: TimeLogType) => {
    if (!currentEmployee || submittingAction) return;
    setSubmittingAction(true);

    try {
      const serverTimestamp = await getSupabaseServerTimestamp();

      const { error } = await supabase.from('time_logs').insert({
        employee_id: currentEmployee.id,
        type,
        timestamp: serverTimestamp,
        notes: fichajeNote.trim() || null,
      });

      if (error) throw error;

      setSuccessInfo({
        title: `¡${getTimeLogTypeLabel(type)} registrada!`,
        subtitle: `Empleado: ${currentEmployee.name}`,
        timestamp: formatDateTimeSpain(serverTimestamp),
      });
      setStep('SUCCESS');
    } catch (err) {
      alert(
        `Error al registrar el fichaje: ${
          err instanceof Error ? err.message : 'Error desconocido'
        }`
      );
    } finally {
      setSubmittingAction(false);
    }
  };

  // Guardar temperaturas APPCC en temperature_logs
  const handleSaveTemperatures = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentEmployee || submittingAction) return;
    setTempError(null);

    // Filtrar las neveras en las que se ha introducido temperatura
    const entriesToSave: Array<{
      fridge: Fridge;
      tempNum: number;
      outOfRange: boolean;
      corrective: string | null;
    }> = [];

    for (const fridge of activeFridges) {
      const rawVal = (tempValues[fridge.id] ?? '').trim().replace(',', '.');
      if (rawVal === '') continue;

      const parsed = parseFloat(rawVal);
      if (isNaN(parsed)) {
        setTempError(
          `La temperatura introducida para "${fridge.name}" no es un número válido.`
        );
        return;
      }

      const outOfRange =
        parsed < Number(fridge.min_temp) || parsed > Number(fridge.max_temp);
      const correctiveText = (correctiveActions[fridge.id] || '').trim();

      if (outOfRange && !correctiveText) {
        setTempError(
          `¡Atención APPCC! La nevera "${fridge.name}" (${parsed}°C) está fuera del rango permitido [${fridge.min_temp}°C a ${fridge.max_temp}°C]. Es obligatorio indicar la "Acción correctora tomada" antes de guardar.`
        );
        return;
      }

      entriesToSave.push({
        fridge,
        tempNum: parsed,
        outOfRange,
        corrective: outOfRange ? correctiveText : correctiveText || null,
      });
    }

    if (entriesToSave.length === 0) {
      setTempError(
        'Introduce la temperatura de al menos una nevera antes de guardar.'
      );
      return;
    }

    setSubmittingAction(true);
    try {
      const serverTimestamp = await getSupabaseServerTimestamp();

      const payload = entriesToSave.map((item) => ({
        fridge_id: item.fridge.id,
        employee_id: currentEmployee.id,
        temperature: item.tempNum,
        recorded_at: serverTimestamp,
        corrective_action: item.corrective,
      }));

      const { error } = await supabase.from('temperature_logs').insert(payload);
      if (error) throw error;

      setSuccessInfo({
        title: `¡Temperaturas APPCC registradas!`,
        subtitle: `${entriesToSave.length} equipo(s) verificado(s) por ${currentEmployee.name}`,
        timestamp: formatDateTimeSpain(serverTimestamp),
      });
      setStep('SUCCESS');
    } catch (err) {
      setTempError(
        `Error al guardar temperaturas: ${
          err instanceof Error ? err.message : 'Error de conexión'
        }`
      );
    } finally {
      setSubmittingAction(false);
    }
  };

  const adjustFridgeTemp = (fridge: Fridge, delta: number) => {
    const currentRaw = (tempValues[fridge.id] ?? '').replace(',', '.');
    const base =
      currentRaw !== '' && !isNaN(parseFloat(currentRaw))
        ? parseFloat(currentRaw)
        : Number(((Number(fridge.min_temp) + Number(fridge.max_temp)) / 2).toFixed(1));
    const nextVal = (base + delta).toFixed(1);
    setTempValues((prev) => ({ ...prev, [fridge.id]: nextVal }));
    setTempError(null);
  };

  // Vista Panel de Administración
  if (step === 'ADMIN' && currentEmployee?.role === 'admin') {
    return (
      <AdminPanel
        currentAdmin={currentEmployee}
        onExitAdmin={() => setStep('DASHBOARD')}
        onDataUpdated={async () => {
          const { data: fridgesData } = await supabase
            .from('fridges')
            .select('*')
            .eq('active', true)
            .order('name', { ascending: true });
          setActiveFridges((fridgesData || []) as Fridge[]);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white flex flex-col justify-between p-4 md:p-8">
      {/* Cabecera Kiosco */}
      <header className="max-w-5xl w-full mx-auto flex flex-wrap items-center justify-between gap-4 bg-slate-900/80 border border-slate-800/90 backdrop-blur-md px-6 py-4 rounded-3xl shadow-xl">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-blue-600/30 font-black text-xl tracking-tighter">
            CT
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-extrabold tracking-tight text-white">
              CONTROL TIENDA · KIOSCO TÁCTIL
            </h1>
            <p className="text-xs text-slate-400">
              Registro Horario (RDL 8/2019) y Control Temperaturas APPCC
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <PwaRegister />
          <div className="text-right">
            <div className="text-2xl md:text-3xl font-black font-mono text-blue-400 tracking-wider">
              {currentTimeStr || '--:--:--'}
            </div>
            <div className="text-xs text-slate-400 capitalize">
              {currentDateStr}
            </div>
          </div>
        </div>
      </header>

      {/* Cuerpo Central del Kiosco */}
      <main className="max-w-5xl w-full mx-auto my-auto py-6 flex items-center justify-center">
        {/* PASO 1: TECLADO NUMÉRICO DE PIN */}
        {step === 'PIN' && (
          <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl">
            <div className="text-center mb-6">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-bold uppercase tracking-wider mb-2">
                <ShieldCheck className="w-4 h-4" />
                Identificación de Empleado
              </span>
              <h2 className="text-2xl font-extrabold text-white">
                Introduce tu PIN (4 dígitos)
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Pulsa los números en la pantalla táctil
              </p>
            </div>

            {/* Indicadores Visuales de los 4 dígitos del PIN */}
            <div className="flex justify-center gap-4 mb-6">
              {[0, 1, 2, 3].map((idx) => {
                const filled = pin.length > idx;
                return (
                  <div
                    key={idx}
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-black transition-all duration-150 border-2 ${
                      filled
                        ? 'bg-blue-600/20 border-blue-500 text-blue-400 scale-105 shadow-lg shadow-blue-500/20'
                        : 'bg-slate-950 border-slate-800 text-slate-700'
                    }`}
                  >
                    {filled ? '●' : ''}
                  </div>
                );
              })}
            </div>

            {pinError && (
              <div className="mb-5 p-3.5 rounded-2xl bg-red-950/80 border border-red-500/50 text-red-200 text-sm font-semibold text-center flex items-center justify-center gap-2 animate-pulse">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{pinError}</span>
              </div>
            )}

            {validatingPin && (
              <div className="mb-5 p-3 rounded-2xl bg-blue-950/60 border border-blue-500/40 text-blue-200 text-sm font-semibold text-center">
                Verificando credenciales en Supabase...
              </div>
            )}

            {/* Teclado Táctil Grande 3x4 */}
            <div className="grid grid-cols-3 gap-3.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  disabled={validatingPin}
                  onClick={() => handleDigitPress(digit)}
                  className="h-20 rounded-2xl bg-slate-800/90 hover:bg-slate-700 active:bg-blue-600 border border-slate-700/80 text-3xl font-extrabold text-white shadow-md transition-all active:scale-95"
                >
                  {digit}
                </button>
              ))}

              <button
                type="button"
                disabled={validatingPin}
                onClick={handleClearPin}
                className="h-20 rounded-2xl bg-slate-950/90 hover:bg-rose-950/60 border border-slate-800 text-sm font-bold uppercase text-rose-400 transition-all active:scale-95"
              >
                Borrar
              </button>

              <button
                type="button"
                disabled={validatingPin}
                onClick={() => handleDigitPress('0')}
                className="h-20 rounded-2xl bg-slate-800/90 hover:bg-slate-700 active:bg-blue-600 border border-slate-700/80 text-3xl font-extrabold text-white shadow-md transition-all active:scale-95"
              >
                0
              </button>

              <button
                type="button"
                disabled={validatingPin}
                onClick={handleBackspace}
                className="h-20 rounded-2xl bg-slate-950/90 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-300 transition-all active:scale-95"
                aria-label="Retroceder un dígito"
              >
                <Delete className="w-7 h-7" />
              </button>
            </div>
          </div>
        )}

        {/* PASO 2: BIENVENIDA AL EMPLEADO, ESTADO ACTUAL Y DOS OPCIONES GRANDES (A: FICHAR, B: REGISTRAR TEMPERATURAS) */}
        {step === 'DASHBOARD' && currentEmployee && (
          <div className="w-full max-w-4xl bg-slate-900/90 border border-slate-800 rounded-3xl p-6 md:p-10 shadow-2xl space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
              <div>
                <div className="flex items-center gap-2 text-blue-400 text-sm font-bold uppercase tracking-wider mb-1">
                  <UserCheck className="w-4 h-4" />
                  <span>Panel de Empleado Activo</span>
                </div>
                <h2 className="text-3xl md:text-4xl font-black text-white">
                  ¡Hola, {currentEmployee.name}!
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  DNI: {currentEmployee.dni}{' '}
                  {lastLog
                    ? `· Último registro: ${getTimeLogTypeLabel(
                        lastLog.type
                      )} (${formatDateTimeSpain(lastLog.timestamp)})`
                    : '· Sin fichajes previos'}
                </p>
              </div>

              {/* Estado Actual del Empleado */}
              <div className="flex flex-col items-start md:items-end">
                <span className="text-xs uppercase font-bold text-slate-400 mb-1.5">
                  Estado Actual
                </span>
                <span
                  className={`px-5 py-2.5 rounded-2xl text-base font-extrabold border flex items-center gap-2.5 ${
                    workStatus === 'WORKING'
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : workStatus === 'PAUSED'
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  <span
                    className={`w-3 h-3 rounded-full ${
                      workStatus === 'WORKING'
                        ? 'bg-emerald-400 animate-ping'
                        : workStatus === 'PAUSED'
                        ? 'bg-amber-400'
                        : 'bg-slate-500'
                    }`}
                  />
                  {getStatusLabel(workStatus)}
                </span>
              </div>
            </div>

            {/* Dos Opciones Grandes: A) FICHAR y B) REGISTRAR TEMPERATURAS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <button
                type="button"
                onClick={() => setStep('FICHAR')}
                className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 p-8 text-left shadow-xl shadow-blue-900/30 transition-all active:scale-98 flex flex-col justify-between min-h-[220px]"
              >
                <div className="w-16 h-16 rounded-2xl bg-white/15 flex items-center justify-center mb-6">
                  <Clock className="w-9 h-9 text-white" />
                </div>
                <div>
                  <span className="text-xs font-extrabold uppercase tracking-widest text-blue-200">
                    Opción A · Control Horario
                  </span>
                  <h3 className="text-3xl font-black text-white mt-1">
                    FICHAR JORNADA
                  </h3>
                  <p className="text-sm text-blue-100/90 mt-2">
                    Registrar Entrada, Inicio de Pausa, Fin de Pausa o Salida con hora oficial del servidor.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setStep('TEMPERATURAS')}
                className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 p-8 text-left shadow-xl shadow-emerald-900/30 transition-all active:scale-98 flex flex-col justify-between min-h-[220px]"
              >
                <div className="w-16 h-16 rounded-2xl bg-white/15 flex items-center justify-center mb-6">
                  <Thermometer className="w-9 h-9 text-white" />
                </div>
                <div>
                  <span className="text-xs font-extrabold uppercase tracking-widest text-emerald-200">
                    Opción B · Sanidad APPCC
                  </span>
                  <h3 className="text-3xl font-black text-white mt-1">
                    REGISTRAR TEMPERATURAS
                  </h3>
                  <p className="text-sm text-emerald-100/90 mt-2">
                    Control diario de cámaras y neveras activas ({activeFridges.length}{' '}
                    equipos).
                  </p>
                </div>
              </button>
            </div>

            {/* Pie del Dashboard: Acceso Admin (si rol === 'admin') y Salir */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={resetToPinScreen}
                className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition-all active:scale-95"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>Cambiar Usuario / Salir</span>
              </button>

              {currentEmployee.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => setStep('ADMIN')}
                  className="flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-extrabold shadow-lg shadow-purple-600/25 transition-all active:scale-95"
                >
                  <Settings className="w-5 h-5" />
                  <span>ABRIR PANEL DE ADMINISTRACIÓN</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* OPCIÓN A: PANTALLA DE FICHAR SEGÚN ESTADO DEL EMPLEADO */}
        {step === 'FICHAR' && currentEmployee && (
          <div className="w-full max-w-3xl bg-slate-900/95 border border-slate-800 rounded-3xl p-6 md:p-10 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-5">
              <div>
                <h2 className="text-2xl md:text-3xl font-black text-white">
                  Registrar Fichaje · {currentEmployee.name}
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Estado actual:{' '}
                  <strong className="text-white">
                    {getStatusLabel(workStatus)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep('DASHBOARD')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Volver</span>
              </button>
            </div>

            {/* Botones Claros Según Estado */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2">
              {workStatus === 'OUTSIDE' && (
                <button
                  type="button"
                  disabled={submittingAction}
                  onClick={() => handleClockAction('IN')}
                  className="sm:col-span-2 py-10 px-8 rounded-3xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white shadow-xl shadow-emerald-600/25 flex flex-col items-center justify-center gap-3 transition-all active:scale-98 disabled:opacity-50"
                >
                  <LogIn className="w-14 h-14" />
                  <span className="text-3xl font-black tracking-tight">
                    FICHAR ENTRADA
                  </span>
                  <span className="text-sm text-emerald-100">
                    Iniciar jornada laboral (Hora oficial del servidor)
                  </span>
                </button>
              )}

              {workStatus === 'WORKING' && (
                <>
                  <button
                    type="button"
                    disabled={submittingAction}
                    onClick={() => handleClockAction('PAUSE_START')}
                    className="py-10 px-6 rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white shadow-xl shadow-amber-600/25 flex flex-col items-center justify-center gap-3 transition-all active:scale-98 disabled:opacity-50"
                  >
                    <Coffee className="w-12 h-12" />
                    <span className="text-2xl font-black">INICIAR PAUSA</span>
                    <span className="text-xs text-amber-100">
                      Descanso / Comida
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={submittingAction}
                    onClick={() => handleClockAction('OUT')}
                    className="py-10 px-6 rounded-3xl bg-gradient-to-br from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white shadow-xl shadow-rose-600/25 flex flex-col items-center justify-center gap-3 transition-all active:scale-98 disabled:opacity-50"
                  >
                    <LogOut className="w-12 h-12" />
                    <span className="text-2xl font-black">FICHAR SALIDA</span>
                    <span className="text-xs text-rose-100">
                      Finalizar jornada laboral
                    </span>
                  </button>
                </>
              )}

              {workStatus === 'PAUSED' && (
                <>
                  <button
                    type="button"
                    disabled={submittingAction}
                    onClick={() => handleClockAction('PAUSE_END')}
                    className="py-10 px-6 rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white shadow-xl shadow-blue-600/25 flex flex-col items-center justify-center gap-3 transition-all active:scale-98 disabled:opacity-50"
                  >
                    <Play className="w-12 h-12" />
                    <span className="text-2xl font-black">FIN DE PAUSA</span>
                    <span className="text-xs text-blue-100">
                      Reanudar jornada laboral
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={submittingAction}
                    onClick={() => handleClockAction('OUT')}
                    className="py-10 px-6 rounded-3xl bg-gradient-to-br from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white shadow-xl shadow-rose-600/25 flex flex-col items-center justify-center gap-3 transition-all active:scale-98 disabled:opacity-50"
                  >
                    <LogOut className="w-12 h-12" />
                    <span className="text-2xl font-black">FICHAR SALIDA</span>
                    <span className="text-xs text-rose-100">
                      Finalizar jornada laboral
                    </span>
                  </button>
                </>
              )}
            </div>

            {/* Campo opcional de nota / incidencia en el fichaje */}
            <div className="pt-2">
              <label className="block text-xs font-bold uppercase text-slate-400 mb-1.5">
                Observaciones / Notas del fichaje (Opcional)
              </label>
              <input
                type="text"
                value={fichajeNote}
                onChange={(e) => setFichajeNote(e.target.value)}
                placeholder="Ej. Turno de mañana, salida médica justificada..."
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-white text-sm"
              />
            </div>
          </div>
        )}

        {/* OPCIÓN B: PANTALLA DE REGISTRAR TEMPERATURAS APPCC */}
        {step === 'TEMPERATURAS' && currentEmployee && (
          <div className="w-full max-w-4xl bg-slate-900/95 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-2xl md:text-3xl font-black text-white flex items-center gap-2.5">
                  <Snowflake className="w-7 h-7 text-cyan-400" />
                  Control de Temperaturas APPCC
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Operario responsable: <strong>{currentEmployee.name}</strong> ·
                  Introduce la lectura actual de cada equipo activo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep('DASHBOARD')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Volver</span>
              </button>
            </div>

            {tempError && (
              <div className="p-4 rounded-2xl bg-red-950/80 border border-red-500 text-red-200 text-sm font-semibold flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <span>{tempError}</span>
              </div>
            )}

            {activeFridges.length === 0 ? (
              <div className="p-8 text-center bg-slate-950/60 rounded-2xl border border-slate-800 space-y-3">
                <p className="text-slate-300 font-semibold">
                  No hay neveras activas configuradas en este momento.
                </p>
                {currentEmployee.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => setStep('ADMIN')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold"
                  >
                    Ir al Panel de Administración para crear neveras
                  </button>
                )}
              </div>
            ) : (
              <form onSubmit={handleSaveTemperatures} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 max-h-[55vh] overflow-y-auto pr-1">
                  {activeFridges.map((fridge) => {
                    const rawVal = (tempValues[fridge.id] ?? '').replace(
                      ',',
                      '.'
                    );
                    const parsedVal = parseFloat(rawVal);
                    const hasNumber = rawVal.trim() !== '' && !isNaN(parsedVal);
                    const outOfRange =
                      hasNumber &&
                      (parsedVal < Number(fridge.min_temp) ||
                        parsedVal > Number(fridge.max_temp));

                    return (
                      <div
                        key={fridge.id}
                        className={`p-5 rounded-2xl border transition-all ${
                          outOfRange
                            ? 'bg-red-950/50 border-red-500 shadow-lg shadow-red-950/40'
                            : hasNumber
                            ? 'bg-emerald-950/30 border-emerald-500/50'
                            : 'bg-slate-950/70 border-slate-800'
                        }`}
                      >
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2.5">
                              <h3 className="text-lg font-extrabold text-white">
                                {fridge.name}
                              </h3>
                              {hasNumber && !outOfRange && (
                                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold">
                                  En rango
                                </span>
                              )}
                              {outOfRange && (
                                <span className="px-2.5 py-0.5 rounded-full bg-red-600 text-white text-xs font-extrabold animate-pulse">
                                  ¡FUERA DE RANGO!
                                </span>
                              )}
                            </div>
                            <p className="text-xs font-mono text-cyan-400 mt-1">
                              Rango sanitario permitido: [{fridge.min_temp} °C a{' '}
                              {fridge.max_temp} °C]
                            </p>
                          </div>

                          {/* Controles táctiles rápidos + Input numérico */}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => adjustFridgeTemp(fridge, -0.5)}
                              className="w-12 h-12 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-lg font-bold text-white active:scale-95"
                            >
                              -0.5
                            </button>

                            <div className="relative">
                              <input
                                type="number"
                                step="0.1"
                                placeholder="0.0"
                                value={tempValues[fridge.id] ?? ''}
                                onChange={(e) => {
                                  setTempValues((prev) => ({
                                    ...prev,
                                    [fridge.id]: e.target.value,
                                  }));
                                  setTempError(null);
                                }}
                                className="w-32 h-12 bg-slate-900 border-2 border-slate-700 focus:border-blue-500 rounded-xl px-3 text-center text-xl font-black font-mono text-white"
                              />
                              <span className="absolute right-2.5 top-3 text-xs font-bold text-slate-400">
                                °C
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => adjustFridgeTemp(fridge, 0.5)}
                              className="w-12 h-12 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-lg font-bold text-white active:scale-95"
                            >
                              +0.5
                            </button>
                          </div>
                        </div>

                        {/* Despliegue obligatorio de "Acción correctora tomada" si está fuera de rango */}
                        {outOfRange && (
                          <div className="mt-4 pt-4 border-t border-red-500/40 space-y-2">
                            <label className="block text-xs font-extrabold uppercase text-red-300 flex items-center gap-1.5">
                              <AlertTriangle className="w-4 h-4 text-red-400" />
                              Acción correctora tomada (OBLIGATORIO POR SANIDAD) *
                            </label>
                            <input
                              type="text"
                              required
                              value={correctiveActions[fridge.id] || ''}
                              onChange={(e) => {
                                setCorrectiveActions((prev) => ({
                                  ...prev,
                                  [fridge.id]: e.target.value,
                                }));
                                setTempError(null);
                              }}
                              placeholder="Describe la medida adoptada (ej. Ajuste de termostato, ciclo desescarche, traslado de producto...)"
                              className="w-full bg-red-950/90 border-2 border-red-400 rounded-xl px-4 py-3 text-white placeholder-red-300/60 text-sm font-medium"
                            />
                            <div className="flex flex-wrap gap-2 pt-1">
                              {[
                                'Ajuste de termostato y nueva comprobación en 1h',
                                'En ciclo de desescarche automático',
                                'Puerta abierta por carga de mercancía',
                                'Traslado de mercancía a cámara auxiliar y aviso a técnico',
                              ].map((suggestion) => (
                                <button
                                  key={suggestion}
                                  type="button"
                                  onClick={() =>
                                    setCorrectiveActions((prev) => ({
                                      ...prev,
                                      [fridge.id]: suggestion,
                                    }))
                                  }
                                  className="text-xs px-2.5 py-1 rounded-lg bg-red-900/60 hover:bg-red-800 text-red-100 border border-red-500/40"
                                >
                                  + {suggestion}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setStep('DASHBOARD')}
                    className="px-6 py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submittingAction}
                    className="px-8 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-lg font-black shadow-xl shadow-emerald-600/25 transition-all active:scale-95"
                  >
                    {submittingAction
                      ? 'Guardando en Supabase...'
                      : 'GUARDAR REGISTRO APPCC'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* PASO DE CONFIRMACIÓN VISUAL DE 3 SEGUNDOS Y RETORNO AUTOMÁTICO AL TECLADO PIN */}
        {step === 'SUCCESS' && successInfo && (
          <div className="w-full max-w-lg bg-emerald-950/90 border-2 border-emerald-500 rounded-3xl p-8 md:p-10 text-center shadow-2xl space-y-5 animate-fade-in">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-12 h-12 text-emerald-400" />
            </div>

            <div className="space-y-2">
              <span className="inline-flex items-center gap-1 text-xs font-extrabold uppercase tracking-widest text-emerald-300">
                <Sparkles className="w-4 h-4" />
                Confirmación Oficial Supabase
              </span>
              <h2 className="text-3xl font-black text-white">
                {successInfo.title}
              </h2>
              <p className="text-base text-emerald-100 font-semibold">
                {successInfo.subtitle}
              </p>
              <p className="text-sm font-mono text-emerald-300 bg-emerald-900/50 py-2 px-4 rounded-xl inline-block">
                Hora Servidor: {successInfo.timestamp}
              </p>
            </div>

            <div className="pt-4">
              <p className="text-xs text-emerald-200/80">
                Volviendo automáticamente al teclado PIN en{' '}
                <strong className="text-white text-sm">{countdown}</strong>{' '}
                segundos...
              </p>
              <button
                type="button"
                onClick={resetToPinScreen}
                className="mt-3 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase"
              >
                Volver ahora
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Pie de página del Kiosco */}
      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-500 py-2">
        Sistema Homologado de Control Horario (RDL 8/2019) y Trazabilidad APPCC
        Sanidad · Conectado en tiempo real a Supabase
      </footer>
    </div>
  );
}
