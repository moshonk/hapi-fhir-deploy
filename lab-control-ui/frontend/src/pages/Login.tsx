// T042: shared-secret login (FR-013/014/015). A wrong secret shows the same
// generic message regardless of how close it was -- the backend already
// enforces this (constant-time compare); the frontend just doesn't add its
// own more-specific wording on top.

import { useState, type FormEvent } from 'react';
import { login } from '../api/client.js';

export interface LoginProps {
  onLoggedIn: () => void;
}

export function Login({ onLoggedIn }: LoginProps) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(secret);
      onLoggedIn();
    } catch {
      setError('Invalid credentials.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <h1>Lab Control UI</h1>
      <form onSubmit={handleSubmit} aria-label="Login">
        <label htmlFor="secret">Shared secret</label>
        <input
          id="secret"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting || secret.length === 0}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
