import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import CorporateLayout from '../../layouts/CorporateLayout';
import { useAuth } from '../../contexts/AuthContext';
import {
  UsersIcon,
  DocumentTextIcon,
  ChartBarIcon,
  ClipboardDocumentCheckIcon,
  CogIcon,
  UserGroupIcon,
  AcademicCapIcon,
  BuildingOfficeIcon,
  PlusIcon,
  EyeIcon,
  PencilIcon
} from '@heroicons/react/24/outline';

const AdminDashboard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalPlans: 0,
    activeAssessments: 0,
    totalGroups: 0
  });
  const [recentActivity, setRecentActivity] = useState([]);

  // Mock data - in real app, this would come from API
  useEffect(() => {
    // Simulate API call
    setStats({
      totalUsers: 24,
      totalPlans: 18,
      activeAssessments: 7,
      totalGroups: 4
    });

    setRecentActivity([
      { id: 1, type: 'user_created', message: 'New employee Alice Chen joined Frontend Team', time: '2 hours ago' },
      { id: 2, type: 'plan_created', message: 'Manager John Smith created React Development plan', time: '4 hours ago' },
      { id: 3, type: 'assessment_completed', message: 'Employee Bob Wilson completed JavaScript Assessment', time: '6 hours ago' },
      { id: 4, type: 'group_created', message: 'New Backend Development team created', time: '1 day ago' }
    ]);
  }, []);

  const quickActions = [
    {
      title: 'Create Learning Plan',
      description: 'Upload PDF or enter text to generate personalized plans',
      icon: DocumentTextIcon,
      href: '/admin/plans/create',
      color: 'bg-blue-500'
    },
    {
      title: 'Manage Users',
      description: 'Add, edit, or assign roles to users',
      icon: UsersIcon,
      href: '/admin/users',
      color: 'bg-green-500'
    },
    {
      title: 'Create Assessment',
      description: 'Design and schedule final assessments',
      icon: ClipboardDocumentCheckIcon,
      href: '/admin/assessments/create',
      color: 'bg-purple-500'
    },
    {
      title: 'View Analytics',
      description: 'Monitor platform usage and performance',
      icon: ChartBarIcon,
      href: '/admin/analytics',
      color: 'bg-orange-500'
    }
  ];

  return (
    <CorporateLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-600">Welcome back, {user?.name}. Here's what's happening with your organization.</p>
          </div>
          <div className="flex items-center space-x-3">
            <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700">
              <PlusIcon className="w-4 h-4 mr-2" />
              Quick Actions
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <UsersIcon className="w-8 h-8 text-blue-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Users</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalUsers}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <DocumentTextIcon className="w-8 h-8 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Learning Plans</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalPlans}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <ClipboardDocumentCheckIcon className="w-8 h-8 text-purple-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Active Assessments</p>
                <p className="text-2xl font-bold text-gray-900">{stats.activeAssessments}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <UserGroupIcon className="w-8 h-8 text-orange-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Teams</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalGroups}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Quick Actions</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {quickActions.map((action) => (
                <Link
                  key={action.title}
                  to={action.href}
                  className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-md transition-all"
                >
                  <div className={`w-10 h-10 ${action.color} rounded-lg flex items-center justify-center mb-3`}>
                    <action.icon className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="font-medium text-gray-900 mb-1">{action.title}</h3>
                  <p className="text-sm text-gray-600">{action.description}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Recent Activity</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-900">{activity.message}</p>
                  <span className="text-xs text-gray-500">{activity.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Team Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Team Performance</h2>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Frontend Team</span>
                  <span className="text-sm font-medium text-green-600">85% completion</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-green-600 h-2 rounded-full" style={{ width: '85%' }}></div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Backend Team</span>
                  <span className="text-sm font-medium text-blue-600">72% completion</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full" style={{ width: '72%' }}></div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Upcoming Assessments</h2>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900">React Fundamentals</p>
                    <p className="text-xs text-gray-600">Frontend Team • Due in 2 days</p>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                    Scheduled
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Node.js Backend</p>
                    <p className="text-xs text-gray-600">Backend Team • Due in 5 days</p>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    Draft
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CorporateLayout>
  );
};

export default AdminDashboard;