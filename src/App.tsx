import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useStore } from './store';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { useEffect, useState } from 'react';
import { SyncService } from './services/sync';
import { notifications } from './services/notifications';
import BottomNav from './components/BottomNav';
import DesktopSidebar from './components/DesktopSidebar';
import Dashibodi from './pages/Dashibodi';
import Bidhaa from './pages/Bidhaa';
import Kikapu from './pages/Kikapu';
import Madeni from './pages/Madeni';
import Historia from './pages/Historia';
import Matumizi from './pages/Matumizi';
import Zaidi from './pages/Zaidi';
import AuditLogs from './pages/AuditLogs';
import ExecutiveDashboard from './pages/ExecutiveDashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import SetupShop from './pages/SetupShop';
import LicenseGuard from './components/LicenseGuard';
import { supabase } from './supabase';
import { Lock, AlertTriangle, Moon, Activity } from 'lucide-react';
import React from 'react';
import { GlobalModal } from './components/GlobalModal';
import ToastContainer from './components/ToastContainer';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-red-50 text-center">
          <AlertTriangle className="w-16 h-16 text-red-600 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Kuna tatizo limetokea</h1>
          <p className="text-gray-600 mb-6 max-w-md">Programu imeshindwa kuendelea. Tafadhali jaribu kupakia upya ukurasa.</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-red-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg"
          >
            Pakia Upya
          </button>
          {process.env.NODE_ENV === 'development' && (
            <pre className="mt-8 p-4 bg-white border border-red-100 rounded-xl text-left text-xs overflow-auto max-w-full">
              {this.state.error?.toString()}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const isAuthenticated = useStore(state => state.isAuthenticated);
  const user = useStore(state => state.user);
  const setAuth = useStore(state => state.setAuth);
  const updateUser = useStore(state => state.updateUser);
  const logout = useStore(state => state.logout);
  const settings = useLiveQuery(() => db.settings.get(1));

  useEffect(() => {
    if (isAuthenticated && user?.shopId && !sessionStorage.getItem('app_opened_logged')) {
      SyncService.logAction('app_opened', { platform: 'web' });
      sessionStorage.setItem('app_opened_logged', 'true');
    }
  }, [isAuthenticated, user?.shopId]);

  useEffect(() => {
    if (isAuthenticated) {
      notifications.initPushNotifications();
      notifications.startService();
    } else {
      notifications.stopService();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    // Listen to Supabase auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        // ONLY force logout if the local token says we are not logged in.
        // If we have a local token, this SIGNED_OUT from Supabase was likely a background 
        // token refresh failure (e.g. gateway timeout / database Disk I/O exhaustion / temporary offline).
        const hasLocalToken = !!localStorage.getItem('pos_token');
        if (!hasLocalToken) {
          logout();
        } else {
          console.warn('Ignore background Supabase SIGNED_OUT event because local session token is still valid.');
        }
      } else if (session && event === 'SIGNED_IN') {
        const path = typeof window !== 'undefined' ? (window.location.hash || window.location.pathname || '') : '';
        const isAuthPage = path.includes('/register') || 
                           path.includes('/login') || 
                           path.includes('/forgot-password') || 
                           path.includes('/reset-password') ||
                           !useStore.getState().isAuthenticated;

        if (isAuthPage) {
          console.log('[App] Skipping SIGNED_IN event on auth pages/states; Login/Register handles profile fetching and setAuth.');
          return;
        }

        // If we already have user data set and isAuthenticated is true, skip to avoid double fetching
        if (useStore.getState().isAuthenticated && useStore.getState().user) {
          console.log('[App] Skipping SIGNED_IN event on already authenticated session.');
          return;
        }

        // If we just signed in, the user data is already set in Login/Register
        // But if it's a page refresh, we might need to fetch user data if it's missing from local storage
        const currentUser = useStore.getState().user;
        if (!currentUser) {
          try {
            const { data: userData } = await supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .single();
              
            if (userData) {
              const localUser = {
                id: userData.id,
                email: session.user.email || '',
                name: userData.name,
                role: userData.role as any,
                shop_id: userData.shop_id,
                shopId: userData.shop_id,
                status: userData.status,
                isActive: userData.status === 'active',
                created_at: userData.created_at,
                updated_at: userData.updated_at,
                isDeleted: 0,
                synced: 1
              };
              setAuth(session.access_token, localUser);
            }
          } catch (e) {
            console.error('Failed to fetch user profile on auth state change', e);
          }
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [setAuth, logout]);

  useEffect(() => {
    const isBoss = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss';
    if (isAuthenticated && isBoss) {
      notifications.requestPermission();
      notifications.startService();
    } else {
      notifications.stopService();
    }
    return () => notifications.stopService();
  }, [isAuthenticated, user?.role]);

  // Periodic check for user status (blocking mechanism)
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      const checkStatus = async () => {
        try {
          // Master Switch: Check both user status and shop status in one query
          const { data: userData, error } = await supabase
            .from('users')
            .select('status, role, shop_id, shop:shops(status)')
            .eq('id', user.id)
            .maybeSingle();

          if (userData && !error) {
            const isUserActive = userData.status === 'active';
            const hasShop = !!userData.shop_id;
            const isShopActive = hasShop ? (userData.shop as any)?.status === 'active' : true;
            
            // Force logout if user is blocked OR if they have a shop and it is blocked
            if (!isUserActive || (hasShop && !isShopActive)) {
              await supabase.auth.signOut();
              logout('Akaunti Imezuiliwa: Tafadhali wasiliana 0787979273');
              return;
            }

            // Sync role and shop_id to prevent local privilege escalation and handle remote assignments
            if (userData.role !== user.role || userData.shop_id !== user.shop_id) {
              updateUser({ 
                role: userData.role as any,
                shop_id: userData.shop_id,
                shopId: userData.shop_id
              });
            }

            // Check for invitations if user has no shop
            if (!userData.shop_id && user.email) {
              const { data: invitation } = await supabase
                .from('shop_invitations')
                .select('*')
                .eq('email', user.email.toLowerCase())
                .maybeSingle();

              if (invitation) {
                // Update user profile with invitation data
                const { error: updateError } = await supabase
                  .from('users')
                  .update({
                    shop_id: invitation.shop_id,
                    role: invitation.role
                  })
                  .eq('id', user.id);

                if (!updateError) {
                  // Delete invitation
                  await supabase.from('shop_invitations').delete().eq('id', invitation.id);
                  
                  // Update local state
                  updateUser({
                    shop_id: invitation.shop_id,
                    shopId: invitation.shop_id,
                    role: invitation.role as any
                  });
                }
              }
            }
          }
        } catch (e) {
          console.error('Failed to check user status', e);
        }
      };

      // Check immediately on mount/auth
      checkStatus();

      // Check every 3 minutes (180,000 ms) instead of 30 seconds to reduce Supabase API traffic
      const interval = setInterval(checkStatus, 180000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, user?.id, user?.isActive, user?.role, user?.shop_id, user?.email]);

  useEffect(() => {
    if (isAuthenticated) {
      // Track last user activity
      let lastActiveTime = Date.now();
      const setIsAppInactive = useStore.getState().setIsAppInactive;
      let lastVisibilitySyncTime = 0;

      const updateActivity = () => {
        const now = Date.now();
        lastActiveTime = now;
        if (useStore.getState().isAppInactive) {
          setIsAppInactive(false);
          console.log('App resumed from inactivity. Triggering critical sync...');
          if (navigator.onLine) {
            SyncService.sync(false, 'critical');
          }
        }
      };

      // Inactivity event listeners for mouse, keyboard, scrolling and touches
      window.addEventListener('mousemove', updateActivity, { passive: true });
      window.addEventListener('keydown', updateActivity, { passive: true });
      window.addEventListener('scroll', updateActivity, { passive: true });
      window.addEventListener('click', updateActivity, { passive: true });
      window.addEventListener('touchstart', updateActivity, { passive: true });

      // Checker interval to update UI badge into Sleep mode exactly 5m after last interaction
      const activityTickInterval = setInterval(() => {
        const currentlyInactive = Date.now() - lastActiveTime > 300000;
        if (currentlyInactive !== useStore.getState().isAppInactive) {
          setIsAppInactive(currentlyInactive);
        }
      }, 5000);

      // Initial sync (full) - added generous randomized startup jitter (2 to 17 seconds)
      // to disperse DB requests and prevent concurrent request storms when multiple clients open/reconnect
      let initialTimer: ReturnType<typeof setTimeout> | null = null;
      const initialJitter = 2000 + Math.floor(Math.random() * 15000);
      initialTimer = setTimeout(() => {
        if (navigator.onLine) {
          SyncService.sync(false, 'full');
        }
      }, initialJitter);

      // Check for broadcast messages
      const checkBroadcasts = async () => {
        try {
          const { data: messages } = await supabase
            .from('broadcast_messages')
            .select('*')
            .eq('status', 'sent')
            .or(`target_role.eq.all,target_role.eq.${user?.role},target_ids.cs.{${user?.id}}`)
            .order('created_at', { ascending: false })
            .limit(1);

          if (messages && messages.length > 0) {
            const latestMsg = messages[0];
            const lastSeenId = localStorage.getItem('last_broadcast_id');

            if (latestMsg.id !== lastSeenId) {
              useStore.getState().showAlert(latestMsg.title, latestMsg.body);
              localStorage.setItem('last_broadcast_id', latestMsg.id);
            }
          }
        } catch (e) {
          console.error('Failed to check broadcasts', e);
        }
      };

      // Initial check for broadcasts
      checkBroadcasts();

      // Dynamic looping timeout references for Sync Scheduling
      let criticalTimer: ReturnType<typeof setTimeout> | null = null;
      let fullTimer: ReturnType<typeof setTimeout> | null = null;

      // Light/Critical sync with 45s base interval + up to 8s randomized jitter to disperse queue pressure
      const scheduleNextCritical = () => {
        const jitterDelay = 45000 + Math.floor(Math.random() * 8000);
        criticalTimer = setTimeout(() => {
          // Pause if user is inactive (5 minutes)
          if (Date.now() - lastActiveTime > 300000) {
            setIsAppInactive(true);
            // Retry checking again once user updates activity; don't infinitely schedule
            return;
          }

          if (navigator.onLine) {
            SyncService.sync(false, 'critical');
          }
          scheduleNextCritical();
        }, jitterDelay);
      };

      // Full sync with 5m (300,000s) base interval + up to 30s randomized jitter
      const scheduleNextFull = () => {
        const jitterDelay = 300000 + Math.floor(Math.random() * 30000);
        fullTimer = setTimeout(() => {
          // Pause if user is inactive (5 minutes)
          if (Date.now() - lastActiveTime > 300000) {
            setIsAppInactive(true);
            return;
          }

          if (navigator.onLine) {
            SyncService.sync(false, 'full');
            checkBroadcasts();
          }
          scheduleNextFull();
        }, jitterDelay);
      };

      // Start the scheduled jitter loops
      scheduleNextCritical();
      scheduleNextFull();

      // Sync when app becomes visible (Throttled focus sync)
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          const now = Date.now();
          lastActiveTime = now; // Window focus counts as activity
          setIsAppInactive(false);

          // Throttled: If sync ran less than 2 minutes (120,000 ms) ago on tab focus, skip it to avoid flooding on quick toggles
          if (now - lastVisibilitySyncTime < 120000) {
            console.log('Skipping focus sync: already synced recently (last 2 minutes)');
            return;
          }

          lastVisibilitySyncTime = now;
          SyncService.sync(false, 'critical');
          checkBroadcasts();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        if (initialTimer) clearTimeout(initialTimer);
        if (criticalTimer) clearTimeout(criticalTimer);
        if (fullTimer) clearTimeout(fullTimer);
        clearInterval(activityTickInterval);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('mousemove', updateActivity);
        window.removeEventListener('keydown', updateActivity);
        window.removeEventListener('scroll', updateActivity);
        window.removeEventListener('click', updateActivity);
        window.removeEventListener('touchstart', updateActivity);
      };
    }
  }, [isAuthenticated, user?.role, user?.id]);

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  // If authenticated but no shop_id, force setup
  const needsShopSetup = !user?.shop_id;
  const isBoss = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'boss';
  const location = useLocation();
  const isKikapu = location.pathname === '/kikapu';

  return (
    <ErrorBoundary>
      <GlobalModal />
      <ToastContainer />
      <LicenseGuard>
        <div className={`flex flex-col md:flex-row h-screen h-[100dvh] bg-gray-50 pt-[env(safe-area-inset-top)] relative ${settings?.darkMode ? 'dark' : ''}`}>
          {/* Mobile Floating Activity Status Indicator */}
          {!needsShopSetup && (
            <div className="fixed top-3 right-3 z-50 md:hidden flex items-center space-x-1 p-1 bg-white/80 backdrop-blur-md rounded-full shadow-sm border border-gray-100 select-none">
              {useStore((s) => s.isAppInactive) ? (
                <div className="flex items-center space-x-1 text-sky-500 bg-sky-500/10 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-wide">
                  <Moon className="w-3 h-3 text-sky-500 animate-pulse shrink-0" />
                  <span>SLEEP</span>
                </div>
              ) : (
                <div className="flex items-center space-x-1 text-emerald-500 bg-emerald-500/10 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-wide">
                  <Activity className="w-3 h-3 text-emerald-500 animate-pulse shrink-0" />
                  <span>ACTIVE</span>
                </div>
              )}
            </div>
          )}

          {/* Desktop Sidebar */}
          {!needsShopSetup && !isKikapu && (
            <div className="hidden md:block">
              <DesktopSidebar />
            </div>
          )}
          
          {/* Main workspace area */}
          <div className={`flex-1 ${isKikapu ? 'h-screen h-[100dvh] overflow-hidden p-0' : 'overflow-y-auto pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6 md:p-6'}`}>
            <Routes>
              {needsShopSetup ? (
                <>
                  <Route path="/setup-shop" element={<SetupShop />} />
                  <Route path="*" element={<Navigate to="/setup-shop" replace />} />
                </>
              ) : (
                <>
                  <Route path="/" element={isBoss ? <Navigate to="/executive" replace /> : <Dashibodi />} />
                  <Route path="/dashibodi" element={<Dashibodi />} />
                  <Route path="/bidhaa" element={<Bidhaa />} />
                  <Route path="/kikapu" element={<Kikapu />} />
                  <Route path="/madeni" element={<Madeni />} />
                  <Route path="/historia" element={<Historia />} />
                  <Route path="/matumizi" element={<Matumizi />} />
                  <Route path="/executive" element={<ExecutiveDashboard />} />
                  <Route path="/audit-logs" element={<AuditLogs />} />
                  <Route path="/zaidi" element={<Zaidi />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </>
              )}
            </Routes>
          </div>
          
          {/* Mobile bottom navigation */}
          {!needsShopSetup && <BottomNav />}
        </div>
      </LicenseGuard>
    </ErrorBoundary>
  );
}
