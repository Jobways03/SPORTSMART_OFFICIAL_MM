'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminAuthService } from '@/services/admin-auth.service';
import { ApiError } from '@/lib/api-client';
import './login.css';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await adminAuthService.login(email, password);
      if (res.data) {
        sessionStorage.setItem('adminAccessToken', res.data.accessToken);
        sessionStorage.setItem('adminRefreshToken', res.data.refreshToken);
        sessionStorage.setItem('admin', JSON.stringify(res.data.admin));
        router.replace('/dashboard');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div className="login-logo">
          <h1>SportSmart</h1>
          <p>Log in to your store admin</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@sportsmart.com"
              required
            />
          </div>
          <div className="login-field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  );
}
