// app/page.tsx
'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  Loader2, 
  Shield,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { Suspense } from 'react';
import { auth } from '@/firebase';
import {
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  AuthError
} from 'firebase/auth';

export const dynamic = 'force-dynamic'; // opt out of SSG to avoid prerender error

// Types
interface FormErrors {
  email?: string;
  password?: string;
  general?: string;
}
interface FormState {
  email: string;
  password: string;
  showPassword: boolean;
  rememberMe: boolean;
  isSubmitting: boolean;
  successMessage: string | null;
}

// ---- Inner component that actually uses useSearchParams ----
function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mounted, setMounted] = useState(false);
  const [formState, setFormState] = useState<FormState>({
    email: '',
    password: '',
    showPassword: false,
    rememberMe: true,
    isSubmitting: false,
    successMessage: null
  });
  const [errors, setErrors] = useState<FormErrors>({});

  // Redirect if already signed in
  useEffect(() => {
    setMounted(true);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        const redirectTo =
          searchParams.get('next') ||
          searchParams.get('redirect') ||
          '/dashboard';
        router.replace(redirectTo);
      }
    });
    return () => unsubscribe();
  }, [router, searchParams]);

  // Clear errors when typing
  useEffect(() => {
    if (errors.email && formState.email) {
      setErrors((prev) => ({ ...prev, email: undefined }));
    }
    if (errors.password && formState.password) {
      setErrors((prev) => ({ ...prev, password: undefined }));
    }
    if (errors.general && (formState.email || formState.password)) {
      setErrors((prev) => ({ ...prev, general: undefined }));
    }
  }, [formState.email, formState.password, errors]);

  // Validation
  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};
    if (!formState.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^\S+@\S+\.\S+$/.test(formState.email.trim())) {
      newErrors.email = 'Please enter a valid email address';
    }
    if (!formState.password) {
      newErrors.password = 'Password is required';
    } else if (formState.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formState.email, formState.password]);

  const canSubmit = useMemo(() => {
    return (
      formState.email.trim().length > 0 &&
      formState.password.length >= 6 &&
      !formState.isSubmitting &&
      Object.keys(errors).length === 0
    );
  }, [formState.email, formState.password, formState.isSubmitting, errors]);

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setFormState((prev) => ({ ...prev, isSubmitting: true, successMessage: null }));
    setErrors({});

    try {
      await setPersistence(
        auth,
        formState.rememberMe ? browserLocalPersistence : browserSessionPersistence
      );

      await signInWithEmailAndPassword(
        auth,
        formState.email.trim(),
        formState.password
      );
      // Redirect handled by onAuthStateChanged
    } catch (error: unknown) {
      const authError = error as AuthError;
      let errorMessage = 'Failed to sign in. Please try again.';
      switch (authError.code) {
        case 'auth/user-not-found':
          errorMessage = 'No account found with this email address.';
          break;
        case 'auth/wrong-password':
          errorMessage = 'Incorrect password. Please try again.';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address format.';
          break;
        case 'auth/invalid-credential':
          errorMessage = 'Invalid email or password.';
          break;
        case 'auth/too-many-requests':
          errorMessage =
            'Too many failed attempts. Please try again later or reset your password.';
          break;
        case 'auth/user-disabled':
          errorMessage = 'This account has been disabled. Please contact support.';
          break;
        case 'auth/network-request-failed':
          errorMessage =
            'Network error. Please check your connection and try again.';
          break;
        default:
          errorMessage = authError.message || 'An unexpected error occurred.';
      }
      setErrors({ general: errorMessage });
    } finally {
      setFormState((prev) => ({ ...prev, isSubmitting: false }));
    }
  };

  // Reset password
  const handleForgotPassword = async () => {
    const email = formState.email.trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setErrors({ general: 'Please enter your email address first.' });
      return;
    }
    setFormState((prev) => ({ ...prev, isSubmitting: true }));
    setErrors({});
    try {
      await sendPasswordResetEmail(auth, email);
      setFormState((prev) => ({
        ...prev,
        successMessage: `Password reset link sent to ${email}. Check your inbox.`,
      }));
    } catch (error: unknown) {
      const authError = error as AuthError;
      setErrors({
        general:
          authError.code === 'auth/user-not-found'
            ? 'No account found with this email address.'
            : 'Failed to send reset email. Please try again.',
      });
    } finally {
      setFormState((prev) => ({ ...prev, isSubmitting: false }));
    }
  };

  const updateFormState = (updates: Partial<FormState>) =>
    setFormState((prev) => ({ ...prev, ...updates }));

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 px-4 py-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-3 bg-blue-600 rounded-2xl shadow-lg">
              <Shield className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Welcome Back
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Sign in to your drug shop account
          </p>
        </div>

        {/* Login Form */}
        <form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm p-8 shadow-xl"
        >
          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                id="email"
                type="email"
                value={formState.email}
                onChange={(e) => updateFormState({ email: e.target.value })}
                placeholder="you@example.com"
                className={`pl-10 pr-4 py-3 w-full rounded-xl border bg-white/60 dark:bg-gray-900/60 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 transition-all ${
                  errors.email 
                    ? 'border-rose-300 dark:border-rose-700 focus:ring-rose-500' 
                    : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
                }`}
                required
                autoComplete="email"
                disabled={formState.isSubmitting}
              />
            </div>
            {errors.email && (
              <p className="mt-2 text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {errors.email}
              </p>
            )}
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                id="password"
                type={formState.showPassword ? 'text' : 'password'}
                value={formState.password}
                onChange={(e) => updateFormState({ password: e.target.value })}
                placeholder="Enter your password"
                className={`pl-10 pr-10 py-3 w-full rounded-1xl border bg-white/60 dark:bg-gray-900/60 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 transition-all ${
                  errors.password 
                    ? 'border-rose-300 dark:border-rose-700 focus:ring-rose-500' 
                    : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
                }`}
                required
                autoComplete="current-password"
                disabled={formState.isSubmitting}
              />
              <button
                type="button"
                onClick={() => updateFormState({ showPassword: !formState.showPassword })}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                disabled={formState.isSubmitting}
                aria-label={formState.showPassword ? 'Hide password' : 'Show password'}
              >
                {formState.showPassword ? (
                  <EyeOff className="h-4 w-4 text-gray-500" />
                ) : (
                  <Eye className="h-4 w-4 text-gray-500" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="mt-2 text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {errors.password}
              </p>
            )}
          </div>

          {/* Options */}
          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={formState.rememberMe}
                  onChange={(e) => updateFormState({ rememberMe: e.target.checked })}
                  className="sr-only"
                  disabled={formState.isSubmitting}
                />
                <div
                  className={`w-5 h-5 rounded border-2 transition-all ${
                    formState.rememberMe
                      ? 'bg-blue-600 border-blue-600'
                      : 'bg-white border-gray-300 dark:bg-gray-800 dark:border-gray-600'
                  }`}
                >
                  {formState.rememberMe && (
                    <CheckCircle2 className="h-4 w-4 text-white absolute top-0.5 left-0.5" />
                  )}
                </div>
              </div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Remember me
              </span>
            </label>

            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={formState.isSubmitting}
              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors disabled:opacity-50"
            >
              Forgot password?
            </button>
          </div>

          {/* Error */}
          {errors.general && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 p-4">
              <p className="text-sm text-rose-700 dark:text-rose-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {errors.general}
              </p>
            </div>
          )}

          {/* Success */}
          {formState.successMessage && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4">
              <p className="text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                {formState.successMessage}
              </p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full inline-flex items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:from-gray-300 disabled:to-gray-400 dark:disabled:from-gray-600 dark:disabled:to-gray-700 text-white font-semibold px-6 py-3.5 text-sm shadow-lg transition-all duration-200 transform hover:scale-[1.02] disabled:scale-100 disabled:cursor-not-allowed"
          >
            {formState.isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign in to your account'
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Don't have a drug shop account{' '}
            <Link
              href="/user-manager/new"
              className="font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors inline-flex items-center gap-1"
            >
              Create one now
              <span aria-hidden="true">→</span>
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

// ---- Page wrapper: provides Suspense boundary for useSearchParams ----
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    }>
      <LoginPageInner />
    </Suspense>
  );
}
