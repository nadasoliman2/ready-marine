'use client';

import { useState } from 'react';
import { useRouter } from '../../../lib/navigation';
import { Anchor, Eye, EyeOff, Lock, User } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import BrandMark from '../../../components/marine/BrandMark';
import { safeRedirect } from '../../../lib/safeRedirect';

export default function AdminLogin() {
  const router = useRouter();
  const { login } = useApp();
  
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
        credentials: 'include'
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Login failed');
      }

      // Simulate a login call so AppContext has user
      login({ username: formData.username, role: 'admin' });
      // Back to the page the admin was on when the session ran out (only an admin page).
      const redirect = safeRedirect('/admin/dashboard');
      router.push(/^\/admin\/(?!login)/.test(redirect) ? redirect : '/admin/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-marine-navy via-marine-teal to-marine-primary flex items-center justify-center p-4 relative overflow-hidden">
      {/* Soft cyan glows behind the card */}
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-marine-cyan/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-marine-cyan/10 rounded-full blur-3xl pointer-events-none" />

      <div className="bg-white p-8 sm:p-10 rounded-3xl w-full max-w-md shadow-2xl relative z-10">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <BrandMark className="w-full max-w-[340px] h-auto object-contain" />
          </div>
          <div className="inline-flex items-center gap-2 bg-marine-mist text-marine-primary rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest mb-3">
            <Anchor size={14} />
            Admin Portal
          </div>
          <h1 className="font-display text-2xl font-bold text-marine-ink">Welcome back</h1>
          <p className="text-marine-muted text-sm mt-1">Sign in to manage Ready Marine</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl text-sm text-center mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-marine-muted uppercase tracking-widest mb-2">Username</label>
            <div className="relative">
              <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-marine-outline pointer-events-none" />
              <input
                type="text"
                required
                value={formData.username}
                onChange={e => setFormData({ ...formData, username: e.target.value })}
                className="w-full bg-marine-canvas border border-marine-line text-marine-ink rounded-xl pl-11 pr-4 py-3 focus:outline-none focus:border-marine-cyan focus:ring-4 focus:ring-marine-cyan/15 transition-all text-sm"
                placeholder="Enter admin username"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-marine-muted uppercase tracking-widest mb-2">Password</label>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-marine-outline pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                className="w-full bg-marine-canvas border border-marine-line text-marine-ink rounded-xl pl-11 pr-11 py-3 focus:outline-none focus:border-marine-cyan focus:ring-4 focus:ring-marine-cyan/15 transition-all text-sm"
                placeholder="Enter password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-marine-outline hover:text-marine-primary focus:outline-none focus:text-marine-cyan transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl transition-all shadow-aura mt-4"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-marine-outline mt-8">Restricted access — authorized staff only</p>
      </div>
    </div>
  );
}
