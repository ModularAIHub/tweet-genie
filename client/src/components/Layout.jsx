import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAccount } from '../contexts/AccountContext';
import { credits } from '../utils/api';
import AccountSwitcher from './AccountSwitcher';
import TwitterTokenStatus from './TwitterTokenStatusV2';
import { isPageVisible } from '../utils/requestCache';
import {
  LayoutDashboard,
  Edit3,
  Calendar,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  CreditCard,
  History,
  Sparkles,
} from 'lucide-react';

const Layout = ({ children }) => {
  const { user, logout } = useAuth();
  const { setSelectedAccount, accounts, selectedAccount } = useAccount();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [creditBalance, setCreditBalance] = useState(null);
  const [loadingCredits, setLoadingCredits] = useState(true);

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Compose', href: '/compose', icon: Edit3 },
    { name: 'Strategy Builder', href: '/strategy', icon: Sparkles, badge: 'New' },
    { name: 'Bulk Generation', href: '/bulk-generation', icon: BarChart3 },
    { name: 'Scheduling', href: '/scheduling', icon: Calendar },
    { name: 'History', href: '/history', icon: History },
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  const isActive = (href) => location.pathname === href;

  // Fetch and refresh credit balance (visibility-aware)
  useEffect(() => {
    if (!user) {
      setCreditBalance(null);
      setLoadingCredits(false);
      return;
    }

    let cancelled = false;
    const fetchCredits = async ({ bypass = false } = {}) => {
      try {
        if (!cancelled) setLoadingCredits(true);
        const response = await credits.getBalanceCached({ ttlMs: 60000, bypass });
        if (!cancelled) {
          setCreditBalance(response.data.balance);
        }
      } catch (error) {
        if (!cancelled) {
          setCreditBalance(0);
        }
      } finally {
        if (!cancelled) setLoadingCredits(false);
      }
    };

    fetchCredits({ bypass: true });

    const interval = setInterval(async () => {
      if (!isPageVisible()) return;
      await fetchCredits();
    }, 5 * 60 * 1000); // 5 minutes

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Twitter Token Status Monitor */}
      <TwitterTokenStatus />
      
      {/* Mobile sidebar backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-gray-600 bg-opacity-75 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:relative lg:flex lg:flex-col ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
          <div className="flex items-center space-x-2">
            {/* Removed round logo icon from sidebar */}
            <span className="text-xl font-bold gradient-text">Tweet Genie</span>
          </div>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 mt-6 px-4 overflow-y-auto">
          <ul className="space-y-2">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className={`flex items-center justify-between px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      isActive(item.href)
                        ? 'bg-primary-50 text-primary-700 border-r-2 border-primary-700'
                        : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                    onClick={() => setIsSidebarOpen(false)}
                  >
                    <div className="flex items-center">
                      <Icon className="mr-3 h-5 w-5" />
                      {item.name}
                    </div>
                    {item.badge && (
                      <span className="px-2 py-0.5 text-xs font-semibold bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-full">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Credits display */}
        <div className="p-4 border-t border-gray-200 flex-shrink-0">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Credits</span>
              <CreditCard className="h-4 w-4 text-gray-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {loadingCredits ? (
                <div className="animate-pulse bg-gray-200 rounded h-8 w-12"></div>
              ) : (
                creditBalance !== null ? creditBalance.toFixed(1) : '--'
              )}
            </div>
            <p className="text-xs text-gray-500">Available credits</p>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="bg-white shadow-sm border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-600"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex items-center space-x-4">
              {/* Account Switcher - only show if user has Twitter accounts */}
              {accounts.length > 0 && (
                <div className="flex items-center space-x-3">
                  <AccountSwitcher />
                  {selectedAccount && (
                    <div className="hidden sm:flex flex-col leading-tight text-xs text-gray-600">
                      <span className="font-semibold text-gray-800">Viewing as</span>
                      <span>@{selectedAccount.account_username || selectedAccount.username}</span>
                    </div>
                  )}
                </div>
              )}
              
              <div className="relative">
                <button
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {/* Removed round profile icon/avatar */}
                  <span className="hidden sm:block">{user?.email || 'User'}</span>
                  <ChevronDown className="h-4 w-4" />
                </button>

                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                    <Link
                      to="/settings"
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      <Settings className="inline h-4 w-4 mr-2" />
                      Settings
                    </Link>
                    <button
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        logout();
                      }}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <LogOut className="inline h-4 w-4 mr-2" />
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
          <div className="page-transition h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
