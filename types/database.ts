export type EmployeeRole = 'admin' | 'staff';

export type TimeLogType = 'IN' | 'OUT' | 'PAUSE_START' | 'PAUSE_END';

export type EmployeeWorkStatus = 'OUTSIDE' | 'WORKING' | 'PAUSED';

export interface Employee {
  id: string;
  name: string;
  dni: string;
  pin_code: string;
  role: EmployeeRole;
  active: boolean;
}

export interface TimeLog {
  id: string;
  employee_id: string;
  type: TimeLogType;
  timestamp: string;
  notes: string | null;
  edited_by: string | null;
  edited_at: string | null;
  employees?: Employee | null;
  editor?: Employee | null;
}

export interface Fridge {
  id: string;
  name: string;
  min_temp: number;
  max_temp: number;
  active: boolean;
}

export interface TemperatureLog {
  id: string;
  fridge_id: string;
  employee_id: string;
  temperature: number;
  recorded_at: string;
  corrective_action: string | null;
  fridges?: Fridge | null;
  employees?: Employee | null;
}
