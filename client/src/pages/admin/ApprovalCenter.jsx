/**
 * ApprovalCenter.jsx — Unified approval center for admin
 * Shows all approval requests: legacy module assignment requests + new approval requests
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { authFetch } from '../../utils/authFetch.js';
import { useNotification } from '../../contexts/NotificationContext.jsx';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import PageContainer from '../../components/PageContainer.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Button from '../../components/Button.jsx';

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
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-bold border ${styles[type] || 'bg-slate-500/20 text-slate-300 border-slate-500/30'}`}>
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
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-bold border ${styles[status] || styles.pending}`}>
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
      <div className="text-sm text-slate-400 mt-1 space-y-0.5">
        <p>📚 <span className="text-slate-300">{module?.title || request.module_id || '—'}</span></p>
        <p>👤 Employee: <span className="text-slate-300">{employee?.name || '—'}</span></p>
        <p>👔 Manager: <span className="text-slate-300">{manager?.name || '—'}</span></p>
        {request.due_date && <p>📅 Due: <span className="text-slate-300">{new Date(request.due_date).toLocaleDateString()}</span></p>}
      </div>
    );
  }
  // New approval request
  return (
    <div className="text-sm text-slate-400 mt-1 space-y-0.5">
      {p.title && <p>📋 <span className="text-slate-300">{p.title}</span></p>}
      {p.targetTitle && <p>🎯 Target: <span className="text-slate-300">{p.targetTitle}</span></p>}
      {p.employeeIds?.length > 0 && <p>👥 Employees: <span className="text-slate-300">{p.employeeIds.length} selected</span></p>}
      {p.category && <p>🏷️ Category: <span className="text-slate-300">{p.category}</span></p>}
      {p.difficulty && <p>⚡ Difficulty: <span className="text-slate-300 capitalize">{p.difficulty}</span></p>}
      {request.notes && <p className="italic text-slate-400">"{request.notes}"</p>}
    </div>
  );
}

export default function ApprovalCenter() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const { notify } = useNotification();
  const setToast = useCallback(({ message, type = 'info' }) => notify(message, type), [notify]);
  const [assignmentRequests, setAssignmentRequests] = useState([]);
  const [approvalRequests, setApprovalRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [modules, setModules] = useState([]);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');
  const [processingId, setProcessingId] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [loadError, setLoadError] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [assignReqs, approvals, usersData, modulesData] = await Promise.allSettled([
        authFetch('/api/assignments/requests'),
        authFetch('/api/approvals'),
        authFetch('/api/users?light=1'),
        authFetch('/api/modules?limit=1000'),
      ]);

      if (assignReqs.status === 'rejected' && approvals.status === 'rejected') {
        setLoadError(assignReqs.reason?.message || 'Could not load approval requests.');
      }
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
      setLoadError(err.message || 'Could not load approval requests.');
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
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterType !== 'all' && r._type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      const requesterName = (r.requesterName || r.requestedBy || r.managerName || '').toLowerCase();
      const moduleName = (r.moduleName || r.module_name || r.actionType || '').toLowerCase();
      if (!requesterName.includes(q) && !moduleName.includes(q)) return false;
    }
    return true;
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

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4" role="dialog" aria-modal="true" aria-label="Reject request">
          <div className="bg-[#1E293B] border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-1">Reject Request</h3>
            <p className="text-slate-400 text-sm mb-4">Optionally provide a reason for rejection.</p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (optional)..."
              rows={3}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-red-500/60 resize-none mb-4"
            />
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" disabled={!!processingId} onClick={() => { setRejectModal(null); setRejectReason(''); }}>
                Cancel
              </Button>
              <Button variant="danger" className="flex-1" loading={!!processingId} onClick={handleReject}>
                {processingId ? 'Rejecting...' : 'Reject Request'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <PageContainer>

        <PageHeader
          icon="⏳"
          title="Approval Center"
          subtitle="Review and action all pending requests from your team"
          actions={
            <>
              <Button variant="secondary" onClick={fetchAll} loading={loading}>Refresh</Button>
              <Button variant="secondary" onClick={() => navigate('/admin/dashboard')}>Back to Dashboard</Button>
            </>
          }
        />

        {loadError && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <span>{loadError}</span>
            <Button variant="danger" size="sm" onClick={fetchAll}>Retry</Button>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          {[
            { label: 'Pending', value: pendingCount, color: 'border-amber-500/30 bg-amber-500/5 text-amber-400', onClick: () => setFilterStatus('pending') },
            { label: 'Approved', value: approvedCount, color: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400', onClick: () => setFilterStatus('approved') },
            { label: 'Rejected', value: rejectedCount, color: 'border-red-500/30 bg-red-500/5 text-red-400', onClick: () => setFilterStatus('rejected') },
          ].map(s => (
            <button
              key={s.label}
              onClick={s.onClick}
              title={`Show ${s.label.toLowerCase()} requests`}
              className={`rounded-2xl border p-5 text-center transition-all hover:scale-[1.01] ${s.color} ${filterStatus === s.label.toLowerCase() ? 'ring-2 ring-current' : ''}`}
            >
              <p className="text-3xl font-bold tabular-nums">{s.value}</p>
              <p className="text-sm font-bold uppercase tracking-wider mt-1 opacity-80">{s.label}</p>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 p-4 sm:p-5 mb-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="relative min-w-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                aria-label="Search requests"
                placeholder="Search by requester name or module…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-indigo-500 transition-colors" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {['pending', 'approved', 'rejected', 'all'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all capitalize ${filterStatus === s ? 'bg-indigo-600 text-white' : 'bg-slate-800/50 border border-slate-700 text-slate-300 hover:text-white'}`}>
                  {s}
                </button>
              ))}
              <SearchableSelect
                value={filterType}
                onChange={setFilterType}
                allLabel="All Types"
                options={[
                  { value: 'assignment_request', label: 'Module Assignment' },
                  { value: 'approval_request', label: 'Approval Request' },
                ]}
              />
              {(search || filterType !== 'all') && (
                <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setFilterType('all'); }}>Clear filters</Button>
              )}
              <span className="text-slate-300 text-sm font-semibold">{filtered.length} {filtered.length === 1 ? 'request' : 'requests'}</span>
            </div>
          </div>
        </div>

        {/* Requests List */}
        {loading ? (
          <div className="text-center py-16">
            <div className="animate-spin text-amber-400 text-4xl mb-4">⟳</div>
            <div className="text-slate-300 text-sm">Loading requests...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-700/60 bg-slate-800/40 text-center py-16 text-slate-300">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-base font-semibold">
              {search || filterType !== 'all'
                ? 'No requests match your filters.'
                : filterStatus === 'pending' ? 'No pending requests.' : `No ${filterStatus} requests.`}
            </p>
            {(search || filterType !== 'all' || filterStatus !== 'all') && (
              <Button variant="secondary" className="mt-4" onClick={() => { setSearch(''); setFilterType('all'); setFilterStatus('all'); }}>
                Clear filters and show all
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {filtered.map(request => {
              const isAssignReq = request._type === 'assignment_request';
              const requesterName = isAssignReq
                ? (users.find(u => (u.userId || u.id) === request.manager_id)?.name || '—')
                : request.requestedByName || '—';
              const dateStr = formatDate(request._sortDate);
              const busy = processingId === request.id;

              return (
                <div
                  key={`${request._type}-${request.id}`}
                  className="min-w-0 rounded-2xl border border-slate-700/60 bg-slate-800/40 p-4 sm:p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <TypeBadge type={request._displayType} />
                        <StatusBadge status={request.status} />
                        {request.priority && (
                          <span className="text-sm text-slate-400 capitalize">Priority: {request.priority}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 mb-1">
                        <span className="text-base font-semibold text-white">Requested by: {requesterName}</span>
                        <span className="text-sm text-slate-400">{dateStr}</span>
                      </div>
                      <RequestDetails request={request} users={users} modules={modules} />
                      {request.rejectionReason && (
                        <p className="text-sm text-red-400 mt-1">Rejection reason: {request.rejectionReason}</p>
                      )}
                      {request.decidedAt && (
                        <p className="text-sm text-slate-400 mt-1">
                          {request.status === 'approved' ? 'Approved' : 'Rejected'} on {formatDate(request.decidedAt)}
                        </p>
                      )}
                    </div>

                    {request.status === 'pending' && (
                      <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
                        <Button variant="success" loading={busy} onClick={() => handleApprove(request)} disabled={!!processingId}>
                          Approve
                        </Button>
                        <Button variant="danger" onClick={() => { setRejectReason(''); setRejectModal(request); }} disabled={!!processingId}>
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 text-center text-slate-400 text-sm">
          Showing both module assignment requests and all approval requests for your company.
        </div>
      </PageContainer>
    </div>
  );
}
