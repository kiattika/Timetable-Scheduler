import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AppData, ActivityLog, ActivityLogAction, AppErrorLog } from '../types';
import { Icons } from '../constants';
import { collection, getDocs, limit, orderBy, query, deleteDoc, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, firestoreDatabaseId } from '../lib/firebase';
import { pruneActivityLogs, saveAppData, ORG_ID } from '../api';
import {
  FirestoreDailyMetric,
  FirestoreUsageResponse,
  DEFAULT_PRICING,
  PricingConfig,
  calculatePeriodCost,
  splitBeforeAfter,
} from '../utils/telemetry';
import {
  Activity,
  BarChart3,
  Calendar,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Database,
  ExternalLink,
  ShieldAlert,
  Server,
  Zap,
  ListFilter,
  UserCheck,
  UserX,
  AlertTriangle,
  FileCode,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Trash2,
  Clock,
  Search
} from 'lucide-react';

interface SystemHealthScreenProps {
  appData: AppData;
  setAppData?: React.Dispatch<React.SetStateAction<AppData | null>>;
}

export const SystemHealthScreen: React.FC<SystemHealthScreenProps> = ({
  appData,
  setAppData,
}) => {
  const [activeTab, setActiveTab] = useState<'telemetry' | 'audit' | 'errors'>('telemetry');
  
  // Real Errors Collection State
  const [errorLogs, setErrorLogs] = useState<AppErrorLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Real Activity Logs Collection State
  const [realActivityLogs, setRealActivityLogs] = useState<ActivityLog[]>([]);
  const [isLoadingActivityLogs, setIsLoadingActivityLogs] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'all' | 'auth' | 'login_failed' | 'schedule'>('all');
  const [activitySearchQuery, setActivitySearchQuery] = useState('');

  const [isPurging, setIsPurging] = useState(false);
  const [purgeStatus, setPurgeStatus] = useState<string | null>(null);

  // Real Cloud Monitoring API State (NO fake data fallback)
  const [usageStats, setUsageStats] = useState<FirestoreUsageResponse | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<number>(7);
  const [pricingConfig] = useState<PricingConfig>(DEFAULT_PRICING);

  // Before / after trial report: the day the change (e.g. read-flip) was switched on. Per-browser convenience.
  const CUTOVER_KEY = 'systemHealth.cutoverDate';
  const [cutoverDate, setCutoverDate] = useState<string>(() => {
    try { return localStorage.getItem(CUTOVER_KEY) || ''; } catch { return ''; }
  });
  const updateCutoverDate = (v: string) => {
    setCutoverDate(v);
    try { v ? localStorage.setItem(CUTOVER_KEY, v) : localStorage.removeItem(CUTOVER_KEY); } catch { /* ignore */ }
  };

  const isAdmin = appData.currentUser?.role === 'admin';
  const orgId = ORG_ID;

  // Real API Call: Fetch usage metrics exclusively via secure callable Cloud Function (Admin only)
  const fetchCloudMonitoringStats = useCallback(async (days: number = selectedDays) => {
    setIsLoadingStats(true);
    setStatsError(null);
    try {
      const getStatsFn = httpsCallable<{ days: number; databaseId?: string }, FirestoreUsageResponse>(
        functions,
        'getFirestoreUsageStats'
      );
      const result = await getStatsFn({ days, databaseId: firestoreDatabaseId || undefined });
      if (result && result.data && result.data.success) {
        setUsageStats(result.data);
      } else {
        throw new Error('ไม่ได้รับข้อมูลสถิติที่ถูกต้องจาก Cloud Function');
      }
    } catch (err: any) {
      console.warn('Notice: Failed to fetch Firestore usage stats from Cloud Function:', err?.message || err);
      let rawMessage = err?.details || err?.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ Google Cloud Monitoring API';
      
      // Parse cryptic Firebase callable errors
      if (rawMessage === 'internal' || err?.code === 'functions/internal' || err?.code === 'internal') {
        rawMessage = `ระบบไม่สามารถดึงข้อมูลสถิติได้ (Error: internal) — อาจเกิดจากยังไม่ได้ Deploy Cloud Function 'getFirestoreUsageStats' บน Firebase (รันคำสั่ง firebase deploy --only functions ในเทอร์มินัล) หรือ Service Account ของโปรเจกต์ยังไม่ได้รับบทบาท 'Monitoring Viewer' (roles/monitoring.viewer) บน Google Cloud IAM`;
      } else if (err?.code === 'functions/unauthenticated' || rawMessage.includes('unauthenticated')) {
        rawMessage = 'จำเป็นต้องเข้าสู่ระบบด้วยสิทธิ์ผู้ดูแลระบบ (@utd.ac.th) เพื่อเรียกดูสถิตินี้';
      } else if (err?.code === 'functions/permission-denied' || rawMessage.includes('permission-denied')) {
        rawMessage = 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่ได้รับอนุญาตให้เข้าถึงสถิติการใช้งานฐานข้อมูล';
      }
      
      setStatsError(rawMessage);
      setUsageStats(null); // Never populate fake data
    } finally {
      setIsLoadingStats(false);
    }
  }, [selectedDays]);

  // Fetch real activity logs from Firestore subcollection apps/{orgId}/activityLogs
  const fetchActivityLogsFromFirestore = useCallback(async () => {
    setIsLoadingActivityLogs(true);
    try {
      const activityRef = collection(db, 'apps', orgId, 'activityLogs');
      const q = query(activityRef, orderBy('timestamp', 'desc'), limit(150));
      const snapshot = await getDocs(q);

      const logs: ActivityLog[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        logs.push({
          id: d.id,
          timestamp: data.timestamp || new Date().toISOString(),
          action: data.action || 'Updated',
          description: data.description || '',
          user: data.user || data.userName || 'Unknown User',
          details: data.details || undefined
        });
      });

      if (logs.length > 0) {
        setRealActivityLogs(logs);
      } else if (appData.activityLogs && appData.activityLogs.length > 0) {
        setRealActivityLogs(appData.activityLogs);
      } else {
        setRealActivityLogs([]);
      }
    } catch (err) {
      console.warn('Failed to fetch activityLogs subcollection, using memory cache:', err);
      if (appData.activityLogs) {
        setRealActivityLogs(appData.activityLogs);
      }
    } finally {
      setIsLoadingActivityLogs(false);
    }
  }, [orgId, appData.activityLogs]);

  // Fetch real error reports from Firestore subcollection apps/{orgId}/errors
  const fetchAndCleanLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const errorsRef = collection(db, 'apps', orgId, 'errors');
      const q = query(errorsRef, orderBy('timestamp', 'desc'), limit(100));
      const snapshot = await getDocs(q);

      const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const validLogs: AppErrorLog[] = [];
      const expiredDocIds: string[] = [];

      snapshot.forEach((d) => {
        const data = d.data();
        const docDate = data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp || Date.now());
        const timeMs = docDate.getTime();

        if (now - timeMs > ONE_WEEK_MS) {
          expiredDocIds.push(d.id);
        } else {
          validLogs.push({
            id: d.id,
            message: data.message || 'Unknown error',
            stack: data.stack,
            timestamp: docDate.toISOString(),
            userEmail: data.userEmail,
            userName: data.userName,
            url: data.url,
            componentStack: data.componentStack,
            details: data.details,
          });
        }
      });

      // Automatically prune expired error log documents (> 7 days)
      if (expiredDocIds.length > 0) {
        for (const docId of expiredDocIds) {
          try {
            await deleteDoc(doc(db, 'apps', orgId, 'errors', docId));
          } catch (e) {
            console.warn('Failed to delete expired error log doc', docId, e);
          }
        }
      }

      setErrorLogs(validLogs);

      if (setAppData && appData.activityLogs && appData.activityLogs.length > 0) {
        const pruned = pruneActivityLogs(appData.activityLogs, 7);
        if (pruned.length !== appData.activityLogs.length) {
          setAppData(prev => prev ? ({ ...prev, activityLogs: pruned }) : prev);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch error logs from Firestore', err);
    } finally {
      setIsLoadingLogs(false);
    }
  }, [orgId, appData.activityLogs, setAppData]);

  useEffect(() => {
    if (isAdmin) {
      fetchCloudMonitoringStats(selectedDays);
      fetchAndCleanLogs();
      fetchActivityLogsFromFirestore();
    }
  }, [isAdmin, selectedDays, fetchCloudMonitoringStats, fetchAndCleanLogs, fetchActivityLogsFromFirestore]);

  const handleManualPurge = async () => {
    if (!confirm('ยืนยันการล้าง Log และ Error ที่มีอายุเกิน 7 วัน (1 สัปดาห์) ทั้งหมดใช่หรือไม่?')) return;
    setIsPurging(true);
    setPurgeStatus(null);
    try {
      await fetchAndCleanLogs();
      await fetchActivityLogsFromFirestore();

      if (setAppData && appData) {
        const cleanedLogs = pruneActivityLogs(appData.activityLogs || [], 7);
        const updatedAppData: AppData = {
          ...appData,
          activityLogs: cleanedLogs,
        };
        setAppData(updatedAppData);
        // Baseline = pre-prune appData: activity-log pruning is a subcollection
        // operation (handled above / by the cleanup function), so this resolves to
        // a no-op rather than re-uploading the whole document.
        await saveAppData(updatedAppData, orgId, appData);
      }

      setPurgeStatus('ล้าง Log และบันทึกข้อผิดพลาดที่เก่ากว่า 7 วันเรียบร้อยแล้ว');
      setTimeout(() => setPurgeStatus(null), 4000);
    } catch (err) {
      console.error('Purge logs error:', err);
      alert('เกิดข้อผิดพลาดในการล้าง log');
    } finally {
      setIsPurging(false);
    }
  };

  const handleDeleteSingleError = async (errorId: string) => {
    if (!confirm('ต้องการลบรายงานข้อผิดพลาดนี้ใช่หรือไม่?')) return;
    try {
      await deleteDoc(doc(db, 'apps', orgId, 'errors', errorId));
      setErrorLogs(prev => prev.filter(e => e.id !== errorId));
    } catch (e: any) {
      alert(`ลบไม่สำเร็จ: ${e?.message || e}`);
    }
  };

  const handleCopyError = (item: AppErrorLog) => {
    const text = `Error ID: ${item.id}\nTime: ${item.timestamp}\nUser: ${item.userEmail || 'N/A'}\nURL: ${item.url || 'N/A'}\nMessage: ${item.message}\nStack: ${item.stack || 'None'}\nComponent Stack: ${item.componentStack || 'None'}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // Filtered Activity Logs
  const filteredActivityLogs = useMemo(() => {
    return realActivityLogs.filter((log) => {
      // 1. Tab Filter
      if (activityFilter === 'auth' && log.action !== 'Logged In' && log.action !== 'Login Failed') {
        return false;
      }
      if (activityFilter === 'login_failed' && log.action !== 'Login Failed') {
        return false;
      }
      if (activityFilter === 'schedule' && ['Logged In', 'Login Failed'].includes(log.action)) {
        return false;
      }

      // 2. Search Query
      if (activitySearchQuery.trim()) {
        const query = activitySearchQuery.toLowerCase();
        const matchesUser = (log.user || '').toLowerCase().includes(query);
        const matchesDesc = (log.description || '').toLowerCase().includes(query);
        const matchesAction = (log.action || '').toLowerCase().includes(query);
        const matchesDetails = (log.details || '').toLowerCase().includes(query);
        return matchesUser || matchesDesc || matchesAction || matchesDetails;
      }

      return true;
    });
  }, [realActivityLogs, activityFilter, activitySearchQuery]);

  // Real Database Document Size in Memory
  const approximateStorageBytes = new Blob([JSON.stringify(appData)]).size;
  const storageUsageMB = +(approximateStorageBytes / (1024 * 1024)).toFixed(2);
  const storagePercentOfFreeGB = +((storageUsageMB / 1024) * 100).toFixed(2);

  // Real Cost Breakdown based ONLY on actual Monitoring API data
  const realCostBreakdown = useMemo(() => {
    if (!usageStats || !usageStats.dailyStats || usageStats.dailyStats.length === 0) {
      return null;
    }
    return calculatePeriodCost(usageStats.dailyStats, pricingConfig, storageUsageMB);
  }, [usageStats, pricingConfig, storageUsageMB]);

  const beforeAfter = useMemo(() => {
    if (!usageStats || !cutoverDate) return null;
    return splitBeforeAfter(usageStats.dailyStats, cutoverDate, usageStats.todayDate);
  }, [usageStats, cutoverDate]);

  if (!isAdmin) {
    return (
      <div className="p-8 flex items-center justify-center text-red-500 h-full font-bold">
        Access Denied. เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถดูหน้านี้ได้
      </div>
    );
  }

  const getActionBadge = (action: ActivityLogAction) => {
    switch (action) {
      case 'Logged In':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <UserCheck className="w-3 h-3 text-emerald-600" />
            เข้าสู่ระบบสำเร็จ
          </span>
        );
      case 'Login Failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-800 border border-red-200">
            <UserX className="w-3 h-3 text-red-600" />
            ล็อกอินล้มเหลว
          </span>
        );
      case 'Added':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800 border border-blue-200">
            เพิ่มข้อมูล
          </span>
        );
      case 'Updated':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            แก้ไขข้อมูล
          </span>
        );
      case 'Removed':
      case 'Cleared':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-200">
            ลบ/ล้างข้อมูล
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-200">
            {action}
          </span>
        );
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* Header & Quick Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-blue-100">
            <Icons.DatabaseZap className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-800">System Health & Telemetry</h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Operational
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              ศูนย์รวมการตรวจสอบสุขภาพระบบ บันทึกความปลอดภัย Audit Logs, Error Reports และการใช้งาน Google Cloud Firestore
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              fetchCloudMonitoringStats(selectedDays);
              fetchAndCleanLogs();
              fetchActivityLogsFromFirestore();
            }}
            disabled={isLoadingStats || isLoadingLogs || isLoadingActivityLogs}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg border border-slate-300 shadow-sm transition-colors disabled:opacity-60"
            title="รีเฟรชข้อมูลทั้งหมด"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${isLoadingStats || isLoadingLogs ? 'animate-spin' : ''}`} />
            <span>{isLoadingStats || isLoadingLogs ? 'กำลังดึงข้อมูล...' : 'รีเฟรชข้อมูลล่าสุด'}</span>
          </button>

          <button
            onClick={handleManualPurge}
            disabled={isPurging || isLoadingLogs}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50"
          >
            <Icons.Delete className="w-4 h-4 text-slate-300" />
            {isPurging ? 'กำลังล้าง Log...' : 'ล้าง Log เก่า (> 7 วัน)'}
          </button>
        </div>
      </div>

      {purgeStatus && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm flex items-center gap-2.5 shadow-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-medium">{purgeStatus}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 space-x-1">
        <button
          onClick={() => setActiveTab('telemetry')}
          className={`flex items-center gap-2 py-3 px-4 font-semibold text-sm border-b-2 transition-all ${
            activeTab === 'telemetry'
              ? 'border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-lg'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-t-lg'
          }`}
        >
          <Server className="w-4 h-4" />
          สถิติการใช้งาน & วางแผนงบประมาณ (Usage & Cost)
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 py-3 px-4 font-semibold text-sm border-b-2 transition-all ${
            activeTab === 'audit'
              ? 'border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-lg'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-t-lg'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          บันทึกกิจกรรม & การเข้าสู่ระบบ (Audit & Security)
          {realActivityLogs.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-slate-200 text-slate-700">
              {realActivityLogs.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('errors')}
          className={`flex items-center gap-2 py-3 px-4 font-semibold text-sm border-b-2 transition-all ${
            activeTab === 'errors'
              ? 'border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-lg'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-t-lg'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          รายงานข้อผิดพลาดระบบ (App Errors)
          {errorLogs.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-red-100 text-red-700 border border-red-200">
              {errorLogs.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: USAGE & COST TELEMETRY */}
      {activeTab === 'telemetry' && (
        <div className="space-y-8 animate-fadeIn">
          {/* Real Google Cloud Monitoring Metrics Section */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-5 md:p-6 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-50/60">
              <div>
                <div className="flex items-center gap-2">
                  <Server className="w-5 h-5 text-blue-600" />
                  <h2 className="text-lg font-bold text-slate-800">
                    สถิติการใช้งานจริงจาก Google Cloud Monitoring API
                  </h2>
                  {usageStats && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 flex items-center gap-1">
                      <Zap className="w-3 h-3 text-blue-600" /> Live Data
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  ดึงข้อมูล Metric จริง (Read / Write / Delete Counts) จาก Google Cloud Platform โดยตรง
                </p>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 font-medium">ช่วงเวลา:</label>
                <select
                  value={selectedDays}
                  onChange={(e) => setSelectedDays(Number(e.target.value))}
                  disabled={isLoadingStats}
                  className="text-xs font-medium bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={7}>ย้อนหลัง 7 วัน</option>
                  <option value={14}>ย้อนหลัง 14 วัน</option>
                  <option value={30}>ย้อนหลัง 30 วัน</option>
                </select>
              </div>
            </div>

            {/* Loading State */}
            {isLoadingStats && (
              <div className="p-12 flex flex-col items-center justify-center text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
                <p className="text-sm font-semibold text-slate-700">กำลังเชื่อมต่อและดึงข้อมูลจาก Cloud Monitoring API...</p>
                <p className="text-xs text-slate-400">ระบบกำลังเรียก Callable Cloud Function: getFirestoreUsageStats</p>
              </div>
            )}

            {/* Error / IAM Permission Required State (NO fake fallback) */}
            {!isLoadingStats && statsError && (
              <div className="p-6 md:p-8 space-y-4">
                <div className="p-5 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 space-y-3">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-amber-900">
                        ไม่สามารถดึงข้อมูลสถิติจาก Google Cloud Monitoring ได้
                      </h3>
                      <p className="text-xs text-amber-800 leading-relaxed font-mono">
                        {statsError}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-amber-200 text-xs text-amber-900 space-y-2">
                    <p className="font-semibold">💡 แนวทางตรวจสอบและตั้งค่าสิทธิ์บน Google Cloud Console:</p>
                    <ol className="list-decimal list-inside space-y-1 pl-1 text-slate-700">
                      <li>เปิด <strong className="text-slate-900">Google Cloud Console → IAM & Admin</strong></li>
                      <li>ค้นหาบัญชี Service Account ที่ใช้รัน Cloud Functions (เช่น <code className="bg-amber-100 px-1 py-0.5 rounded text-amber-900">App Engine default service account</code>)</li>
                      <li>เพิ่มบทบาท <code className="bg-amber-100 font-bold px-1.5 py-0.5 rounded text-amber-900">Monitoring Viewer (roles/monitoring.viewer)</code></li>
                      <li>ตรวจสอบว่าเปิดใช้งาน <strong className="text-slate-900">Cloud Monitoring API</strong> (<code className="text-slate-800">monitoring.googleapis.com</code>) บนโปรเจกต์แล้ว</li>
                    </ol>
                  </div>

                  <div className="pt-2 flex items-center gap-3">
                    <button
                      onClick={() => fetchCloudMonitoringStats(selectedDays)}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
                    >
                      ลองดึงข้อมูลอีกครั้ง
                    </button>
                    <span className="text-[11px] text-amber-700 italic">
                      *ระบบปฏิบัติตามมาตรฐานความปลอดภัย ไม่มีการสร้างตัวเลขสุ่มหรือแสดงข้อมูลเท็จหากดึงข้อมูลจริงไม่ได้
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Real Stats Success State */}
            {!isLoadingStats && !statsError && usageStats && (
              <div className="p-6 space-y-6">
                {/* Metadata Summary Banner */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl text-xs">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div>
                      <span className="text-slate-500">Project ID:</span>{' '}
                      <span className="font-mono font-bold text-slate-800">{usageStats.projectId}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">ช่วงวันที่:</span>{' '}
                      <span className="font-semibold text-slate-800">{usageStats.timeRange.startDate} ถึง {usageStats.timeRange.endDate}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">แหล่งข้อมูล:</span>{' '}
                      <span className="font-semibold text-blue-700">{usageStats.source}</span>
                    </div>
                  </div>
                  <div className="text-slate-500">
                    ดึงข้อมูลเมื่อ: <span className="font-mono text-slate-700">{new Date(usageStats.fetchedAt).toLocaleTimeString('th-TH')}</span>
                  </div>
                </div>

                {/* Data-quality warnings: never let a broken query look like "0 usage" */}
                {!usageStats.bucketing && (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>Cloud Function <code>getFirestoreUsageStats</code> บนเซิร์ฟเวอร์ยังเป็นรุ่นเก่า: ตัวเลข "รายวัน" เป็นช่วง 24 ชม. ย้อนหลังจากเวลาที่กดรีเฟรช ไม่ใช่วันที่ตามปฏิทิน และรวมทุกฐานข้อมูลในโปรเจกต์ — ต้อง deploy functions ใหม่ก่อนจึงจะเทียบก่อน/หลังได้แม่นยำ</span>
                  </div>
                )}
                {usageStats.metricErrors && usageStats.metricErrors.length > 0 && (
                  <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-xs text-red-800 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>ดึงบาง Metric ไม่สำเร็จ ตัวเลขที่เป็น 0 อาจไม่ใช่ค่าจริง: {usageStats.metricErrors.join(' | ')}</span>
                  </div>
                )}
                {usageStats.bucketing && usageStats.seriesFound === 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>ไม่พบข้อมูล Metric ของฐานข้อมูล <code>{usageStats.databaseId || '(ทั้งหมด)'}</code> ในช่วงนี้ — ถ้าคาดว่าต้องมีการใช้งาน ให้ตรวจว่า VITE_FIREBASE_DATABASE_ID ตรงกับฐานข้อมูลที่ใช้จริง</span>
                  </div>
                )}
                {usageStats.bucketing && usageStats.databaseId && (
                  <p className="text-[11px] text-slate-500 -mt-2">
                    นับเฉพาะฐานข้อมูล <code className="font-mono">{usageStats.databaseId}</code> · วันที่เป็นเวลาไทย (00:00–24:00) · การอ่านจาก script ตรวจสอบ/migrate และ Admin SDK ก็ถูกนับรวมด้วย
                  </p>
                )}

                {/* Top Metric Cards from Real Monitoring Data */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider">Document Reads รวม</span>
                    <div className="text-2xl font-bold text-slate-800 mt-1">
                      {usageStats.totals.totalReads.toLocaleString()}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      เฉลี่ย {usageStats.totals.dailyAverageReads.toLocaleString()} reads/วัน
                    </p>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Document Writes รวม</span>
                    <div className="text-2xl font-bold text-slate-800 mt-1">
                      {usageStats.totals.totalWrites.toLocaleString()}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      เฉลี่ย {usageStats.totals.dailyAverageWrites.toLocaleString()} writes/วัน
                    </p>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">ขนาดข้อมูลแอป (ประมาณ)</span>
                    <div className="text-2xl font-bold text-slate-800 mt-1">
                      {storageUsageMB} MB
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      นับจากข้อมูลที่โหลดในเบราว์เซอร์ ไม่ใช่ขนาดที่เก็บจริงบน Firestore
                    </p>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">สถานะค่าบริการจริง</span>
                    <div className={`text-2xl font-bold mt-1 ${realCostBreakdown && realCostBreakdown.totalCostThb > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {realCostBreakdown ? `${realCostBreakdown.totalCostThb.toFixed(2)} ฿` : '0.00 ฿'}
                    </div>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      {realCostBreakdown && realCostBreakdown.totalCostThb > 0 ? (
                        <><AlertTriangle className="w-3.5 h-3.5 text-red-600" /> มีวันที่เกินโควตาฟรีรายวัน</>
                      ) : (
                        <><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> ทุกวันอยู่ในโควตาฟรีรายวัน</>
                      )}
                    </p>
                  </div>
                </div>

                {/* Daily Real Breakdown Table */}
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-100/80 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3">วันที่ (Date)</th>
                        <th className="px-4 py-3 text-right">Document Reads</th>
                        <th className="px-4 py-3 text-right">Document Writes</th>
                        <th className="px-4 py-3 text-right">Document Deletes</th>
                        <th className="px-4 py-3 text-center">สถานะ Free Quota (50k reads / 20k writes / 20k deletes ต่อวัน)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {usageStats.dailyStats.map((item) => {
                        const overWhat = [
                          item.reads > pricingConfig.freeDailyReads ? 'reads' : '',
                          item.writes > pricingConfig.freeDailyWrites ? 'writes' : '',
                          item.deletes > pricingConfig.freeDailyDeletes ? 'deletes' : '',
                        ].filter(Boolean);
                        const isOverReads = overWhat.length > 0;
                        const isToday = item.date === usageStats.todayDate;
                        return (
                          <tr key={item.date} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-2.5 font-medium font-mono text-slate-800">{item.date}{isToday && <span className="ml-2 text-[10px] font-sans font-semibold text-amber-600">วันนี้ (ยังไม่ครบวัน)</span>}</td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold text-blue-700">
                              {item.reads.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-700">
                              {item.writes.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-slate-500">
                              {item.deletes.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {isOverReads ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">เกินโควตาฟรี ({overWhat.join(', ')})</span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">100% Free</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Before / After trial report */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-5 md:p-6 border-b border-slate-200 bg-slate-50/60 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-indigo-600" />
                  รายงานเทียบก่อน / หลังทดลอง
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  เลือกวันที่เริ่มทดลอง (เช่น วันที่เปิด VITE_READ_FROM_SUBCOLLECTIONS) ระบบจะแยกสถิติเป็น “ก่อน” และ “หลัง” ให้เทียบกัน
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-slate-500 font-medium" htmlFor="cutover-date">เริ่มทดลองวันที่:</label>
                <input
                  id="cutover-date"
                  type="date"
                  value={cutoverDate}
                  onChange={(e) => updateCutoverDate(e.target.value)}
                  className="text-xs bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => updateCutoverDate(usageStats?.todayDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }))}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                >
                  ตั้งเป็นวันนี้
                </button>
                {cutoverDate && (
                  <button
                    type="button"
                    onClick={() => updateCutoverDate('')}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg text-slate-500 hover:text-red-600"
                  >
                    ล้าง
                  </button>
                )}
              </div>
            </div>

            <div className="p-5 md:p-6 space-y-4">
              {!usageStats ? (
                <p className="text-sm text-slate-400 text-center py-6">รอข้อมูลสถิติด้านบนโหลดก่อน</p>
              ) : !cutoverDate ? (
                <p className="text-sm text-slate-500 text-center py-6">เลือก “วันที่เริ่มทดลอง” เพื่อดูรายงานเทียบ (วันที่เริ่มทดลองนับเป็นฝั่ง “หลัง”)</p>
              ) : beforeAfter && (
                <>
                  {(cutoverDate < usageStats.timeRange.startDate || cutoverDate > usageStats.timeRange.endDate) && (
                    <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900">
                      วันที่เริ่มทดลองอยู่นอกช่วงที่ดึงข้อมูล ({usageStats.timeRange.startDate} ถึง {usageStats.timeRange.endDate}) — เลือกช่วงเวลาให้ยาวขึ้นด้านบน (สูงสุด 30 วัน)
                    </div>
                  )}
                  {!usageStats.bucketing && (
                    <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900">
                      ตัวเลขรายวันยังเป็นรุ่นเก่า (ไม่ตรงวันที่ตามปฏิทิน) — รายงานนี้ใช้เป็นแนวโน้มคร่าว ๆ เท่านั้นจนกว่าจะ deploy functions
                    </div>
                  )}
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-left text-xs text-slate-700">
                      <thead className="bg-slate-100/80 font-semibold border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">ตัวชี้วัด (เฉลี่ยต่อวัน)</th>
                          <th className="px-4 py-3 text-right">ก่อนทดลอง</th>
                          <th className="px-4 py-3 text-right">หลังทดลอง</th>
                          <th className="px-4 py-3 text-right">เปลี่ยนแปลง</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {([
                          ['Document Reads', beforeAfter.before.avgReads, beforeAfter.after.avgReads, beforeAfter.deltaPercent.reads],
                          ['Document Writes', beforeAfter.before.avgWrites, beforeAfter.after.avgWrites, beforeAfter.deltaPercent.writes],
                          ['Document Deletes', beforeAfter.before.avgDeletes, beforeAfter.after.avgDeletes, beforeAfter.deltaPercent.deletes],
                          ['Reads สูงสุดในวันเดียว', beforeAfter.before.peakReads, beforeAfter.after.peakReads, null],
                        ] as [string, number, number, number | null][]).map(([label, b, a, d]) => (
                          <tr key={label}>
                            <td className="px-4 py-2.5 font-sans font-medium text-slate-800">{label}</td>
                            <td className="px-4 py-2.5 text-right">{b.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right font-bold">{a.toLocaleString()}</td>
                            <td className={`px-4 py-2.5 text-right font-bold ${d === null ? 'text-slate-400' : d > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                              {d === null ? '–' : `${d > 0 ? '+' : ''}${d}%`}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-slate-50/60 font-sans text-slate-500">
                          <td className="px-4 py-2.5">จำนวนวันที่ใช้คำนวณ</td>
                          <td className="px-4 py-2.5 text-right">
                            {beforeAfter.before.days} วัน{beforeAfter.before.firstDate ? ` (${beforeAfter.before.firstDate} – ${beforeAfter.before.lastDate})` : ''}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {beforeAfter.after.days} วัน{beforeAfter.after.firstDate ? ` (${beforeAfter.after.firstDate} – ${beforeAfter.after.lastDate})` : ''}
                            {beforeAfter.after.partialOnly ? ' · วันนี้ยังไม่ครบวัน' : ''}
                          </td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <ul className="text-[11px] text-slate-500 space-y-1 list-disc pl-5">
                    <li>วันนี้ (ยังไม่ครบวัน) ไม่ถูกนำไปเฉลี่ย ยกเว้นฝั่ง “หลัง” ยังไม่มีวันที่ครบเลย</li>
                    <li>วันที่เริ่มทดลองมีการใช้งานปนทั้งสองแบบ ถ้าต้องการความแม่นยำสูงให้เทียบตั้งแต่วันถัดไป</li>
                    <li>คาดว่าหลังเปิดอ่านจาก subcollection Reads จะเพิ่มประมาณ 800 ต่อการเปิดแอปหนึ่งครั้งต่อผู้ใช้ ส่วน Writes ควรใกล้เดิม</li>
                    <li>วันที่เริ่มทดลองถูกจำไว้ในเบราว์เซอร์นี้เท่านั้น</li>
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: AUDIT & SECURITY LOGS */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden space-y-6 p-6 animate-fadeIn">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                บันทึกกิจกรรมและการเข้าสู่ระบบ (Audit & Security Trail)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                ติดตามการล็อกอินสำเร็จ, ความพยายามเข้าสู่ระบบที่ล้มเหลว, และการเปลี่ยนแปลงข้อมูลตารางสอน
              </p>
            </div>

            {/* Filter Chips & Search Bar */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="ค้นหาชื่อ, อีเมล หรือกิจกรรม..."
                  value={activitySearchQuery}
                  onChange={(e) => setActivitySearchQuery(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
                />
              </div>

              <div className="flex items-center bg-slate-100 p-1 rounded-lg text-xs font-medium">
                <button
                  onClick={() => setActivityFilter('all')}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    activityFilter === 'all' ? 'bg-white text-slate-800 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  ทั้งหมด ({realActivityLogs.length})
                </button>
                <button
                  onClick={() => setActivityFilter('auth')}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    activityFilter === 'auth' ? 'bg-white text-slate-800 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  การเข้าสู่ระบบ
                </button>
                <button
                  onClick={() => setActivityFilter('login_failed')}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    activityFilter === 'login_failed' ? 'bg-white text-red-700 shadow-sm font-bold' : 'text-slate-600 hover:text-red-700'
                  }`}
                >
                  ล็อกอินล้มเหลว
                </button>
                <button
                  onClick={() => setActivityFilter('schedule')}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    activityFilter === 'schedule' ? 'bg-white text-slate-800 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  แก้ไขตาราง
                </button>
              </div>
            </div>
          </div>

          {/* Activity Logs Table */}
          {isLoadingActivityLogs ? (
            <div className="py-16 text-center space-y-2 text-slate-500 text-sm">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-600" />
              <p>กำลังดึงประวัติ Audit Logs จาก Firestore...</p>
            </div>
          ) : filteredActivityLogs.length === 0 ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <ShieldCheck className="w-12 h-12 mx-auto text-slate-300" />
              <p className="text-sm font-medium text-slate-600">ไม่พบบันทึกกิจกรรมตามเงื่อนไขที่เลือก</p>
              <p className="text-xs text-slate-400">ระบบจะบันทึกกิจกรรมโดยอัตโนมัติเมื่อมีการล็อกอินหรือจัดการตารางเรียน</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">วัน-เวลา (Timestamp)</th>
                    <th className="px-4 py-3">ประเภทกิจกรรม</th>
                    <th className="px-4 py-3">ผู้ใช้งาน / บัญชี</th>
                    <th className="px-4 py-3">รายละเอียดกิจกรรม</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredActivityLogs.map((log) => {
                    const logDate = new Date(log.timestamp);
                    const formattedDate = !isNaN(logDate.getTime())
                      ? logDate.toLocaleString('th-TH', {
                          dateStyle: 'medium',
                          timeStyle: 'medium',
                        })
                      : log.timestamp;

                    return (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                          {formattedDate}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {getActionBadge(log.action)}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {log.user || 'Unknown User'}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <div>{log.description}</div>
                          {log.details && (
                            <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                              {log.details}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: APPLICATION ERROR REPORTS */}
      {activeTab === 'errors' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden space-y-6 p-6 animate-fadeIn">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <h2 className="text-lg font-bold text-slate-800">
                  รายงานข้อผิดพลาดของระบบ (Application Error Reports)
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                  Subcollection: <code className="text-slate-900 font-mono">apps/{orgId}/errors</code>
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                ดึงข้อมูลจริงจาก GlobalErrorBoundary และ Error Handler เพื่อตรวจหาสาเหตุการหยุดทำงานของระบบ
              </p>
            </div>

            <button
              onClick={fetchAndCleanLogs}
              disabled={isLoadingLogs}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? 'animate-spin' : ''}`} />
              ดึงข้อมูล Error ล่าสุด
            </button>
          </div>

          {isLoadingLogs ? (
            <div className="py-16 text-center space-y-2 text-slate-500 text-sm">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-red-600" />
              <p>กำลังดึงรายงานข้อผิดพลาดจาก Firestore...</p>
            </div>
          ) : errorLogs.length === 0 ? (
            <div className="py-16 text-center space-y-3 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
              <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-800">ไม่พบข้อผิดพลาดในระบบ (Zero Errors Detected)</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  ระบบทำงานปกติสมบูรณ์ ไม่มีรายงาน Unhandled Exception หรือ UI Crash ถูกบันทึกไว้ในช่วง 7 วันที่ผ่านมา
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {errorLogs.map((item) => {
                const isExpanded = expandedErrorId === item.id;
                const errorDate = new Date(item.timestamp);
                const formattedDate = !isNaN(errorDate.getTime())
                  ? errorDate.toLocaleString('th-TH', {
                      dateStyle: 'medium',
                      timeStyle: 'medium',
                    })
                  : item.timestamp;

                return (
                  <div
                    key={item.id}
                    className="border border-red-200 bg-white rounded-xl overflow-hidden shadow-xs hover:border-red-300 transition-colors"
                  >
                    {/* Error Item Header */}
                    <div className="p-4 bg-red-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0 mt-0.5">
                          <AlertCircle className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-semibold text-xs sm:text-sm text-red-950 font-mono">
                            {item.message}
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 mt-1">
                            <span className="flex items-center gap-1 font-mono">
                              <Clock className="w-3 h-3" />
                              {formattedDate}
                            </span>
                            {item.userEmail && (
                              <span className="font-medium text-slate-700">
                                ผู้ใช้งาน: {item.userEmail}
                              </span>
                            )}
                            {item.url && (
                              <span className="truncate max-w-xs text-slate-400">
                                URL: {item.url}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          onClick={() => handleCopyError(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg border border-slate-200 shadow-xs transition-colors"
                          title="คัดลอกรายละเอียด Error"
                        >
                          {copiedId === item.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-slate-500" />
                          )}
                          <span>{copiedId === item.id ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
                        </button>

                        {(item.stack || item.componentStack) && (
                          <button
                            onClick={() => setExpandedErrorId(isExpanded ? null : item.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg shadow-xs transition-colors"
                          >
                            <FileCode className="w-3.5 h-3.5 text-slate-300" />
                            <span>{isExpanded ? 'ซ่อน Stack' : 'ดู Stack Trace'}</span>
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        )}

                        <button
                          onClick={() => handleDeleteSingleError(item.id)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                          title="ลบรายงานนี้"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Stack Trace Collapsible Panel */}
                    {isExpanded && (
                      <div className="p-4 bg-slate-900 text-slate-200 text-xs font-mono border-t border-red-100 space-y-3 overflow-x-auto max-h-80">
                        {item.stack && (
                          <div>
                            <div className="text-red-400 text-[11px] font-bold mb-1">Stack Trace:</div>
                            <pre className="whitespace-pre-wrap leading-relaxed text-slate-300 text-[11px]">
                              {item.stack}
                            </pre>
                          </div>
                        )}
                        {item.componentStack && (
                          <div>
                            <div className="text-blue-400 text-[11px] font-bold mb-1">Component Hierarchy:</div>
                            <pre className="whitespace-pre-wrap leading-relaxed text-slate-300 text-[11px]">
                              {item.componentStack}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
