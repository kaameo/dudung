import { SignupForm } from '@/components/auth-forms';

export const metadata = { title: '회원가입' };

export default async function SignupPage({ searchParams }: PageProps<'/signup'>) {
  const { next } = await searchParams;
  return <SignupForm next={typeof next === 'string' ? next : undefined} />;
}
