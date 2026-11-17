-- Estructura de base de datos en Supabase para Control Tienda (Inspección de Trabajo y Sanidad APPCC)

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dni text not null,
  pin_code text not null,
  role text not null check (role in ('admin', 'staff')) default 'staff',
  active boolean not null default true
);

create table if not exists public.time_logs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  type text not null check (type in ('IN', 'OUT', 'PAUSE_START', 'PAUSE_END')),
  timestamp timestamptz not null default now(),
  notes text,
  edited_by uuid references public.employees(id) on delete set null,
  edited_at timestamptz
);

create table if not exists public.fridges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  min_temp numeric not null,
  max_temp numeric not null,
  active boolean not null default true
);

create table if not exists public.temperature_logs (
  id uuid primary key default gen_random_uuid(),
  fridge_id uuid not null references public.fridges(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  temperature numeric not null,
  recorded_at timestamptz not null default now(),
  corrective_action text
);

-- Empleado administrador inicial (PIN: 1234)
insert into public.employees (name, dni, pin_code, role, active)
select 'Administrador Tienda', '00000000A', '1234', 'admin', true
where not exists (select 1 from public.employees where pin_code = '1234');
