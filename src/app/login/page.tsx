import { LoginForm } from '@/components/auth-forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: '로그인' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next } = await searchParams;
  return (
    <LoginForm
      next={typeof next === 'string' ? next : undefined}
      testLoginEnabled={process.env.TEST_LOGIN_ENABLED === 'true' || process.env.TEST_LOGIN_ENABLED === '1'}
    />
  );
}
