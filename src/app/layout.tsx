import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth-provider';
import { Nav } from '@/components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: { default: '두둥 · 라이브 방송', template: '%s · 두둥' },
  description: '브라우저만으로 PC 화면과 휴대폰 카메라를 송출하고 로그인 없이 시청하는 라이브 방송 서비스',
};

export const viewport: Viewport = { themeColor: '#0d0e11', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh">
        <AuthProvider>
          <Nav />
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
