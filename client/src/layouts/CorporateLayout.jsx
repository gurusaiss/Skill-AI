import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  HomeIcon,
  UsersIcon,
  ChartBarIcon,
  DocumentTextIcon,
  CogIcon,
  Bars3Icon,
  XMarkIcon,
  UserGroupIcon,
  ClipboardDocumentCheckIcon,
  AcademicCapIcon,
  BuildingOfficeIcon
} from '@heroicons/react/24/outline';

const CorporateLayout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout, hasRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
  };

  // Navigation items based on role
  const getNavigationItems = () => {
    const baseItems = [
      {
        name: 'Dashboard',
        href: `/${user?.role}/dashboard`,
        icon: HomeIcon,
        current: location.pathname === `/${user?.role}/dashboard`
      }
    ];

    if (hasRole('admin')) {
      return [
        ...baseItems,
        {
          name: 'Users & Groups',
          href: '/admin/users',
          icon: UsersIcon,
          current: location.pathname.startsWith('/admin/users')
        },
        {
          name: 'Learning Plans',
          href: '/admin/plans',
          icon: DocumentTextIcon,
          current: location.pathname.startsWith('/admin/plans')
        },
        {
          name: 'Assessments',
          href: '/admin/assessments',
          icon: ClipboardDocumentCheckIcon,
          current: location.pathname.startsWith('/admin/assessments')
        },
        {
          name: 'Analytics',
          href: '/admin/analytics',
          icon: ChartBarIcon,
          current: location.pathname.startsWith('/admin/analytics')
        },
        {
          name: 'Settings',
          href: '/admin/settings',
          icon: CogIcon,
          current: location.pathname.startsWith('/admin/settings')
        }
      ];
    }

    if (hasRole('manager')) {
      return [
        ...baseItems,
        {
          name: 'My Team',
          href: '/manager/team',
          icon: UserGroupIcon,
          current: location.pathname.startsWith('/manager/team')
        },
        {
          name: 'Learning Plans',
          href: '/manager/plans',
          icon: DocumentTextIcon,
          current: location.pathname.startsWith('/manager/plans')
        },
        {
          name: 'Assessments',
          href: '/manager/assessments',
          icon: ClipboardDocumentCheckIcon,
          current: location.pathname.startsWith('/manager/assessments')
        },
        {
          name: 'Progress Reports',
          href: '/manager/progress',
          icon: ChartBarIcon,
          current: location.pathname.startsWith('/manager/progress')
        }
      ];
    }

    if (hasRole('employee')) {
      return [
        ...baseItems,
        {
          name: 'My Learning',
          href: '/employee/learning',
          icon: AcademicCapIcon,
          current: location.pathname.startsWith('/employee/learning')
        },
        {
          name: 'Assessments',
          href: '/employee/assessments',
          icon: ClipboardDocumentCheckIcon,
          current: location.pathname.startsWith('/employee/assessments')
        },
        {
          name: 'Progress',
          href: '/employee/progress',
          icon: ChartBarIcon,
          current: location.pathname.startsWith('/employee/progress')
        }
      ];
    }

    return baseItems;
  };

  const navigation = getNavigationItems();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0`}>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-center h-16 px-4 bg-gradient-to-r from-blue-600 to-indigo-600">
            <BuildingOfficeIcon className="w-8 h-8 text-white" />
            <span className="ml-2 text-xl font-bold text-white">SkillForge</span>
          </div>

          {/* User info */}
          <div className="px-4 py-4 border-b border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full flex items-center justify-center">
                  <span className="text-white font-medium text-sm">
                    {user?.name?.split(' ').map(n => n[0]).join('').toUpperCase()}
                  </span>
                </div>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-4 space-y-2">
            {navigation.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200 ${
                  item.current
                    ? 'bg-blue-100 text-blue-700 border-r-2 border-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
                onClick={() => setSidebarOpen(false)}
              >
                <item.icon className="w-5 h-5 mr-3" />
                {item.name}
              </Link>
            ))}
          </nav>

          {/* Logout */}
          <div className="px-4 py-4 border-t border-gray-200">
            <button
              onClick={handleLogout}
              className="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-600 rounded-md hover:bg-gray-100 hover:text-gray-900 transition-colors duration-200"
            >
              <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex h-16 bg-white shadow-sm">
          <button
            className="px-4 text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Bars3Icon className="w-6 h-6" />
          </button>

          <div className="flex flex-1 justify-between px-4">
            <div className="flex flex-1">
              <div className="flex w-full md:ml-0">
                <label htmlFor="search-field" className="sr-only">
                  Search
                </label>
                <div className="relative w-full text-gray-400 focus-within:text-gray-600">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center">
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <input
                    id="search-field"
                    className="block h-full w-full border-0 py-2 pl-8 pr-3 text-gray-900 placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-0 focus:border-transparent sm:text-sm"
                    placeholder="Search..."
                    type="search"
                    name="search"
                  />
                </div>
              </div>
            </div>
            <div className="ml-4 flex items-center md:ml-6">
              {/* Notifications */}
              <button className="p-1 text-gray-400 rounded-full hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5v-5zM4.868 12.683A17.925 17.925 0 012 21h16a2 2 0 002-2V9a2 2 0 00-2-2H9.697a2 2 0 00-1.414.586l-2.414 2.414A1 1 0 006.586 10H4a2 2 0 00-2 2v1.586a1 1 0 00.293.707z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
};

export default CorporateLayout;