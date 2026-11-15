import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sizeParam = Number(searchParams.get('size')) || 192;
  const size = sizeParam === 512 ? 512 : 192;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1d4ed8 0%, #0f172a 100%)',
          borderRadius: size === 512 ? '96px' : '36px',
          color: 'white',
          fontWeight: 800,
          fontSize: size === 512 ? 180 : 68,
          letterSpacing: '-0.04em',
        }}
      >
        CT
      </div>
    ),
    {
      width: size,
      height: size,
    }
  );
}
