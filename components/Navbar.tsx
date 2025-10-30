// components/Navbar.tsx
'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  User,
  Menu,
  X,
  LogOut,
  Settings,
  Home,
  ClipboardList,
  Shield,
  Users,
  Pill,
  Moon,
  Sun,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { useTheme } from 'next-themes';

import app, { database } from '@/firebase';
import { getAuth, signOut } from 'firebase/auth';
import { ref, onValue, query as dbQuery, orderByChild, startAt } from 'firebase/database';

type NavItem = { name: string; href: string; icon: any; badge?: number | null };

function cn(...cls: Array<string | false | undefined>) {
  return cls.filter(Boolean).join(' ');
}
function parseNum(n: unknown) {
  if (typeof n === 'number') return n;
  if (typeof n === 'string') {
    const x = Number(n);
    return Number.isFinite(x) ? x : 0;
  }
  return 0;
}

const Navbar = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Menus
  const [isOpen, setIsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const profileRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // Firebase
  const auth = getAuth(app);
  const user = auth.currentUser;

  // Live counts
  const [inspectionsCount, setInspectionsCount] = useState<number>(0);
  const [boundedCount, setBoundedCount] = useState<number>(0);

  // Demo notifications (wire to DB later if you want)
  const notifications = [
    { id: 1, title: 'New inspection assigned', time: '5 min ago', unread: true },
    { id: 2, title: 'Bounded drug report ready', time: '1 hour ago', unread: true },
    { id: 3, title: 'New user registration pending', time: '2 hours ago', unread: false },
  ];
  const unreadCount = notifications.filter(n => n.unread).length;

  useEffect(() => setMounted(true), []);

  // Subscribe: inspections total
  useEffect(() => {
    const node = ref(database, 'inspections');
    const unsub = onValue(
      node,
      snap => {
        const val = snap.val() as Record<string, any> | null;
        setInspectionsCount(val ? Object.keys(val).length : 0);
      },
      () => setInspectionsCount(0)
    );
    return () => unsub();
  }, []);

  // Subscribe: bounded drugs where boxesImpounded > 0
  useEffect(() => {
    const q = dbQuery(ref(database, 'inspections'), orderByChild('boxesImpounded'), startAt(1 as any));
    const unsub = onValue(
      q,
      snap => {
        const val = snap.val() as Record<string, any> | null;
        if (!val) return setBoundedCount(0);
        const count = Object.values(val).reduce((acc, row: any) => (parseNum(row?.boxesImpounded) > 0 ? acc + 1 : acc), 0);
        setBoundedCount(count);
      },
      () => setBoundedCount(0)
    );
    return () => unsub();
  }, []);

  // Close popovers on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menus on route change
  useEffect(() => {
    setIsOpen(false);
    setIsProfileOpen(false);
    setIsNotificationsOpen(false);
  }, [pathname]);

  const navigation: NavItem[] = useMemo(
    () => [
      { name: 'Dashboard', href: '/dashboard', icon: Home, badge: null },
      { name: 'Inspection Form', href: '/inspections/new', icon: ClipboardList, badge: inspectionsCount || null },
      { name: 'Inspections', href: '/inspections', icon: Pill, badge: boundedCount || null },
    ],
    [inspectionsCount, boundedCount]
  );

  const userNavigation = [
    { name: 'Profile', href: '/profile', icon: User },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  async function handleSignOut() {
    if (signingOut) return;
    try {
      setSigningOut(true);
      // Close the menu first for snappy UX
      setIsProfileOpen(false);
      await signOut(auth);
      // Prefer client navigation; AuthGate will also protect routes post-signout
      router.replace('/login');
    } catch (err) {
      // If navigation or signOut throws, hard redirect as fallback
      console.error('Sign out failed, falling back to hard redirect:', err);
      try {
        window.location.href = '/login';
      } catch {
        // no-op
      }
    } finally {
      // If replace succeeds we won't see this; harmless if we do
      setSigningOut(false);
    }
  }

  if (!mounted) return null;

  return (
    <nav className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200/50 dark:border-gray-700/50 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left: logo + nav */}
          <div className="flex items-center space-x-8">
            <Link href="/dashboard" className="flex-shrink-0" aria-label="Home">
              <Shield className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center space-x-1">
              {navigation.map(item => {
                const Icon = item.icon;
                const active = pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      'group relative flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200',
                      active
                        ? 'bg-gray-100/70 dark:bg-gray-800/60'
                        : 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 mr-2',
                        active
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-gray-600 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400'
                      )}
                    />
                    <span
                      className={cn(
                        active
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-gray-700 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400'
                      )}
                    >
                      {item.name}
                    </span>
                    {typeof item.badge === 'number' && item.badge > 0 && (
                      <span className="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded-full">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Right: theme, profile, mobile toggle */}
          <div className="flex items-center space-x-4">
            {/* Theme */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-lg hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-colors duration-200"
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="h-5 w-5 text-yellow-500" /> : <Moon className="h-5 w-5 text-gray-600" />}
            </button>

            {/* Profile */}
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setIsProfileOpen(v => !v)}
                className="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-colors duration-200"
                aria-haspopup="menu"
                aria-expanded={isProfileOpen}
              >
                <div className="h-8 w-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                  <User className="h-5 w-5 text-white" />
                </div>
                <span className="hidden md:block text-sm font-medium text-gray-700 dark:text-gray-200">
                  {user?.displayName || user?.email || 'User'}
                </span>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </button>

              {isProfileOpen && (
                <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50">
                  <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {user?.displayName || 'Account'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[180px]">
                      {user?.email || 'No email'}
                    </p>
                  </div>

                  {userNavigation.map(item => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        className="flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-150"
                      >
                        <Icon className="h-4 w-4 mr-3" />
                        {item.name}
                      </Link>
                    );
                  })}

                  <button
                    onClick={handleSignOut}
                    disabled={signingOut}
                    aria-busy={signingOut}
                    className="w-full text-left flex items-center px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors duration-150 disabled:opacity-60"
                  >
                    {signingOut ? <Loader2 className="h-4 w-4 mr-3 animate-spin" /> : <LogOut className="h-4 w-4 mr-3" />}
                    {signingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              )}
            </div>

            {/* Mobile menu */}
            <button
              onClick={() => setIsOpen(v => !v)}
              className="md:hidden p-2 rounded-lg hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-colors duration-200"
              aria-label="Toggle menu"
              aria-expanded={isOpen}
            >
              {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {isOpen && (
          <div className="md:hidden border-t border-gray-200 dark:border-gray-700">
            <div className="px-2 pt-2 pb-3 space-y-1">
              {navigation.map(item => {
                const Icon = item.icon;
                const active = pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      'flex items-center px-3 py-2 text-base font-medium rounded-lg transition-colors duration-200',
                      active
                        ? 'bg-gray-100/70 dark:bg-gray-800/60'
                        : 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="h-5 w-5 mr-3 text-gray-600 dark:text-gray-300" />
                    <span className="text-gray-700 dark:text-gray-200">{item.name}</span>
                    {typeof item.badge === 'number' && item.badge > 0 && (
                      <span className="ml-auto px-2 py-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded-full">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
