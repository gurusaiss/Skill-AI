/**
 * ApprovalCenter.jsx — Unified approval center for admin
 * Shows all approval requests: legacy module assignment requests + new approval requests
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authFetch } from '../../utils/authFetch.js';

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed top-5 right-5 z-[200] flex items-center gap-3 px-5 py-3 rounded-xl text-white text-sm font-semibold shadow-2xl border
      ${type === 'success' ? 'bg-emerald-600/95 border-emerald-500/50' : type === 'error' ? 'bg-red-600/95 border-red-500/50' : 'bg-indigo-600/95 border-indigo-500/50'}`}>
      <span>{type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
      <span>{message}</span>
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">✕</button>
    </div>
  );
}

function TypeBadge({ type }) {
  const styles = {
    create_assessment:  'bg-amber-500/20 text-amber-300 border-amber-500/30',
    assign_assessment:  'bg-blue-500/20 text-blue-300 border-blue-500/30',
    create_module:      'bg-violet-500/20 text-violet-300 border-violet-500/30',
    assign_module:      'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    module_assignment:  'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  };
  const labels = {
    create_assessment: 'Create Assessment',
    assign_assessment: 'Assign Assessment',
    create_module:     'Create Module',
    assign_module:     'Assign Module',
    module_assignment: 'Module Assignment',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${styles[type] || 'bg-slate-500/20 text-slate-300 border-slate-500/30'}`}>
      {labels[type] || type}
    </span>
  );
}

function StatusBadge({ status }) {
  const styles = {
    pending:  'bg-amber-500/20 text-amber-400 border-amber-500/30',
    approved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${styles[status] || styles.pending}`}>
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending'}
    </span>
  );
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function RequestDetails({ request, users, modules }) {
  const p = request.payload || {};
  if (request._type === 'assignment_request') {
    const manager = users.find(u => (u.userId || u.id) === request.manager_id);
    const employee = users.find(u => (u.userId || u.id) === request.employee_id);
    const module = modules.find(m => m.id === request.module_id);
    return (
      <div className="text-xs text-slate-400 mt-1 space-y-0.5">
        <p>📚 <span className="text-slate-300">{module?.title || request.module_id || '—'}</span></p>
        <p>👤 Employee: <span className="text-slate-300">{employee?.name || '—'}</span></p>
        <p>👔 Manager: <span className="text-slate-300">{manager?.name || '—'}</span></p>
        {request.due_date && <p>📅 Due: <span className="text-slate-300">{new Date(request.due_date).toLocaleDateString()}</span></p>}
      </div>
    );
  }
  // New approval request
  return (
    <div className="text-xs text-slate-400 mt-1 space-y-0.5">
      {p.title && <p>📋 <span className="text-slate-300">{p.title}</span></p>}
      {p.targetTitle && <p>🎯 Target: <span className="text-slate-300">{p.targetTitle}</span></p>}
      {p.employeeIds?.length > 0 && <p>👥 Employees: <span className="text-slate-300">{p.employeeIds.length} selected</span></p>}
      {p.category && <p>🏷️ Category: <span className="text-slate-300">{p.category}</span></p>}
      {p.difficulty && <p>⚡ Difficulty: <span className="text-slate-300 capitalize">{p.difficulty}</span></p>}
      {request.notes && <p className="italic text-slate-500">"{request.notes}"</p>}
    </div>
  );
}

export default function ApprovalCenter() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [assignmentRequests, setAssignmentRequests] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState([]);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [processingId, setProcessingId] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [assignReqs, approvals, usersData, modulesData] = await Promise.allSettled([
        authFetch('/api/assignments/requests'),
        authFetch('/api/approvals'),
        authFetch('/api/users'),
        authFetch('/api/modules'),
      ]);

      setAssignmentRequests(
        assignReqs.status === 'fulfilled'
          ? (assignReqs.value?.requests || assignReqs.value || [])
          : []
      );
      setApprovalRequests(
        approvals.status === 'fulfilled'
          ? (approvals.value?.requests || approvals.value || [])
          : []
      );
      setUsers(
        usersData.status === 'fulfilled'
          ? (usersData.value?.users || usersData.value || [])
          : []
      );
      setModules(
        modulesData.status === 'fulfilled'
          ? (modulesData.value?.modules || modulesData.value || [])
          : []
      );
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || !hasRole('admin')) { navigate('/dashboard'); return; }
    fetchAll();
  }, [user, navigate, fetchAll]);

  // Merge both types into unified list
  const allRequests = [
    ...assignmentRequests.map(r => ({ ...r, _type: 'assignment_request', _displayType: 'module_assignment', _sortDate: r.requested_at || r.created_at })),
    ...approvalRequests.map(r => ({ ...r, _type: 'approval_request', _displayType: r.actionType, _sortDate: r.requestedAt })),
  ].sort((a, b) => (b._sortDate || '') > (a._sortDate || '') ? 1 : -1);

  const filtered = allRequests.filter(r => {
    if (filterStatus === 'all') return true;
    return r.status === filterStatus;
  });

  const pendingCount = allRequests.filter(r => r.status === 'pending').length;
  const approvedCount = allRequests.filter(r => r.status === 'approved').length;
  const rejectedCount = allRequests.filter(r => r.status === 'rejected').length;

  const handleApprove = async (request) => {
    const id = request.id;
    setProcessingId(id);
    try {
      if (request._type === 'assignment_request') {
        await authFetch(`/api/assignments/requests/${id}/approve`, { method: 'POST' });
      } else {
        await authFetch(`/api/approvals/${id}/approve`, { method: 'PUT' });
      }
      setToast({ message: 'Request approved', type: 'success' });
      fetchAll();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectModal) return;
    const request = rejectModal;
    setProcessingId(request.id);
    try {
      if (request._type === 'assignment_request') {
        await authFetch(`/api/assignments/requests/${request.id}/reject`, { method: 'POST' });
      } else {
        await authFetch(`/api/approvals/${request.id}/reject`, {
          method: 'PUT',
          body: JSON.stringify({ reason: rejectReason }),
        });
      }
      setToast({ message: 'Request rejected', type: 'info' });
      setRejectModal(null);
      setRejectReason('');
      fetchAll();
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  if (!user || !hasRole('admin')) return null;

  return (
    <div className="min-h-screen bg-[#0F172A] text-[#F8FAFC]">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-1">Reject Request</h3>
            <p className="text-slate-400 text-sm mb-4">Optionally provide a reason for rejection.</p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (optional)..."
              rows={3}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/60 resize-none mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setRejectModal(null); setRejectReason(''); }}
                className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={!!processingId}
                className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30 font-bold text-sm transition-colors disabled:opacity-50"
              >
                {processingId ? 'Rejecting...' : '✕ Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 py-8 lg:px-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-600/20 border border-amber-500/20 text-xl">⏳</div>
              <div>
                <h1 className="text-2xl font-bold text-white">Approval Center</h1>
                <p className="text-amber-400 text-sm font-semibold">Admin Panel</p>
              </div>
            </div>
            <p className="text-slate-400 text-sm mt-1 ml-[52px]">Review and action all pending requests from your team</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchAll}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-bold text-sm transition-colors"
            >
              ↻ Refresh
            </button>
            <button
              onClick={() => navigate('/admin/dashboard')}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-xl text-white font-bold text-sm transition-colors"
            >
              ← Dashboard
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Pending', value: pendingCount, color: 'border-amber-500/30 bg-amber-500/5 text-amber-400', onClick: () => setFilterStatus('pending') },
            { label: 'Approved', value: approvedCount, color: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400', onClick: () => setFilterStatus('approved') },
            { label: 'Rejected', value: rejectedCount, color: 'border-red-500/30 bg-red-500/5 text-red-400', onClick: () => setFilterStatus('rejected') },
          ].map(s => (
            <button
              key={s.label}
              onClick={s.onClick}
              className={`rounded-xl border p-4 text-center transition-all hover:scale-[1.02] ${s.color} ${filterStatus === s.label.toLowerCase() ? 'ring-1 ring-current' : ''}`}
            >
              <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              <p className="text-xs font-bold uppercase tracking-wider mt-0.5 opacity-70">{s.label}</p>
            </button>
          ))}
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-5">
          {['pending', 'approved', 'rejected', 'all'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all capitalize ${
                filterStatus === s
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800/50 border border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
          <span className="ml-auto text-slate-500 text-sm self-center">{filtered.length} requests</span>
        </div>

        {/* Requests List */}
        {loading ? (
          <div className="text-center py-16">
            <div className="animate-spin text-amber-400 text-4xl mb-4">⟳</div>
            <div className="text-slate-400 text-sm">Loading requests...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-sm font-semibold">
              {filterStatus === 'pending' ? 'No pending requests.' : `No ${filterStatus} requests.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(request => {
              const isAssignReq = request._type === 'assignment_request';
              const requesterName = isAssignReq
                ? (users.find(u => (u.userId || u.id) === request.manager_id)?.name || '—')
                : request.requestedByName || '—';
              const dateStr = formatDate(request._sortDate);

              return (
                <div
                  key={request.id}
                  className="bg-[#1E293B] border border-slate-700/60 rounded-xl p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <TypeBadge type={request._displayType} />
                        <StatusBadge status={request.status} />
                        {request.priority && (
                          <span className="text-xs text-slate-500 capitalize">Priority: {request.priority}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-white">Requested by: {requesterName}</span>
                        <span className="text-xs text-slate-500">·</span>
                        <span className="text-xs text-slate-500">{dateStr}</span>
                      </div>
                      <RequestDetails request={request} users={users} modules={modules} />
                      {request.rejectionReason && (
                        <p className="text-xs text-red-400 mt-1">Rejection reason: {request.rejectionReason}</p>
                      )}
                      {request.decidedAt && (
                        <p className="text-xs text-slate-600 mt-1">
                          {request.status === 'approved' ? 'Approved' : 'Rejected'} on {formatDate(request.decidedAt)}
                        </p>
                      )}
                    </div>

                    {request.status === 'pending' && (
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleApprove(request)}
                          disabled={processingId === request.id}
                          className="px-4 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 text-xs font-bold transition-all disabled:opacity-50"
                        >
                          {processingId === request.id ? '...' : '✓ Approve'}
                        </button>
                        <button
                          onClick={() => setRejectModal(request)}
                          disabled={processingId === request.id}
                          className="px-4 py-2 rounded-lg bg-red-600/20 border border-red-500/30 text-red-300 hover:bg-red-600/30 text-xs font-bold transition-all disabled:opacity-50"
                        >
                          ✕ Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 text-center text-slate-600 text-xs">
          Showing both module assignment requests and all approval requests for your company.
        </div>
      </div>
    </div>
  );
}
