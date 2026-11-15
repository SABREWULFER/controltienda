import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Control Tienda | Horario Empleados y APPCC Sanidad',
  description:
    'Kiosco táctil de control horario de empleados (Inspección de Trabajo España) y registro de temperaturas APPCC (Sanidad).',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ControlTienda',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/api/icon?size=192', sizes: '192x192', type: 'image/png' },
      { url: '/api/icon?size=512', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/api/icon?size=192', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
