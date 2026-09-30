'use client';

import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { adminErrorText, signInWithKey } from '@/lib/admin';

/** Admins sign in with a security key only: no password exists to phish or leak. */
export function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithKey(email.trim());
      router.push('/admin');
    } catch (caught) {
      setError(adminErrorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-live" aria-hidden />
            Admin sign-in
          </CardTitle>
          <CardDescription>Enter your EQOWA email, then touch your security key when it blinks.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-sm text-text-muted">Email</span>
            <input
              type="email"
              required
              autoComplete="username webauthn"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-text focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-[#ff8a8e]">
              {error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Touch your key' : 'Sign in with security key'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
