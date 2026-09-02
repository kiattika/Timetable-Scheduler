import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AppData, ActivityLog, ActivityLogAction, AppErrorLog } from '../types';
import { Icons } from '../constants';
import { collection, getDocs, limit, orderBy, query, deleteDoc, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../lib/firebase';
import { pruneActivityLogs, saveAppData, ORG_ID } from '../api';
import {
  FirestoreDailyMetric,
  FirestoreUsageResponse,
  DEFAULT_PRICING,
  PricingConfig,
  calculatePeriodCost,
} from '../utils/telemetry';
import {
  Activity,
  BarChart3,
  Calendar,
  DollarSign,
  Coins,
  ShieldCheck,
  Calculator,
  RefreshCw,
  Info,
  CheckCircle2,
  AlertCircle,
  Sliders,
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

  // Budget Simulator State (Interactive estimation tool where user defines inputs)
  const [simTeachersCount, setSimTeachersCount] = useState<number>(appData.teachers?.length || 120);
  const [simStudentsCount, setSimStudentsCount] = useState<number>(2500);
  const [simDailyTeacherViews, setSimDailyTeacherViews] = useState<number>(3);
  const [simDailyStudentViews, setSimDailyStudentViews] = useState<number>(2);
  const [simDailyScheduleUpdates, setSimDailyScheduleUpdates] = useState<number>(25);

  const isAdmin = appData.currentUser?.role === 'admin';
  const orgId = ORG_ID;

  // Real API Call: Fetch usage metrics exclusively via secure callable Cloud Function (Admin only)
  const fetchCloudMonitoringStats = useCallback(async (days: number = selectedDays) => {
    setIsLoadingStats(true);
    setStatsError(null);
    try {
      const getStatsFn = httpsCallable<{ days: number }, FirestoreUsageResponse>(
        functions,
        'getFirestoreUsageStats'
      );
      const result = await getStatsFn({ days });
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

  // Budget Simulator Calculation (Explicit user input model)
  const simulationResult = useMemo(() => {
    const teacherDailyReads = simTeachersCount * simDailyTeacherViews * 1.5;
    const studentDailyReads = simStudentsCount * simDailyStudentViews * 1.0;
    const updateDailyReads = simDailyScheduleUpdates * 2;
    const estimatedDailyReads = Math.round(teacherDailyReads + studentDailyReads + updateDailyReads);

    const estimatedDailyWrites = Math.round(simDailyScheduleUpdates * 4.5);
    const estimatedDailyDeletes = Math.round(simDailyScheduleUpdates * 0.5);

    const billableDailyReads = Math.max(0, estimatedDailyReads - pricingConfig.freeDailyReads);
    const billableDailyWrites = Math.max(0, estimatedDailyWrites - pricingConfig.freeDailyWrites);

    const dailyCostUsd =
      (billableDailyReads / 100000) * pricingConfig.readCostPer100kUsd +
      (billableDailyWrites / 100000) * pricingConfig.writeCostPer100kUsd;

    const dailyCostThb = dailyCostUsd * pricingConfig.thbExchangeRate;
    const monthlyCostThb = dailyCostThb * 30;
    const semesterCostThb = monthlyCostThb * 4.5;
    const annualCostThb = monthlyCostThb * 12;

    const readCapacityUsedPercent = Math.min(100, (estimatedDailyReads / pricingConfig.freeDailyReads) * 100);
    const writeCapacityUsedPercent = Math.min(100, (estimatedDailyWrites / pricingConfig.freeDailyWrites) * 100);

    return {
      estimatedDailyReads,
      estimatedDailyWrites,
      estimatedDailyDeletes,
      billableDailyReads,
      billableDailyWrites,
      dailyCostThb: +dailyCostThb.toFixed(2),
      monthlyCostThb: +monthlyCostThb.toFixed(2),
      semesterCostThb: +semesterCostThb.toFixed(2),
      annualCostThb: +annualCostThb.toFixed(2),
      readCapacityUsedPercent: +readCapacityUsedPercent.toFixed(1),
      writeCapacityUsedPercent: +writeCapacityUsedPercent.toFixed(1),
      isFreeTierCovered: dailyCostThb === 0,
    };
  }, [
    simTeachersCount,
    simStudentsCount,
    simDailyTeacherViews,
    simDailyStudentViews,
    simDailyScheduleUpdates,
    pricingConfig,
  ]);

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
                    <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Storage Footprint</span>
                    <div className="text-2xl font-bold text-slate-800 mt-1">
                      {storageUsageMB} MB
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {storagePercentOfFreeGB}% ของโควตาฟรี 1,024 MB
                    </p>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">สถานะค่าบริการจริง</span>
                    <div className="text-2xl font-bold text-emerald-600 mt-1">
                      {realCostBreakdown ? `${realCostBreakdown.totalCostThb.toFixed(2)} ฿` : '0.00 ฿'}
                    </div>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      อยู่ในโควตา Spark Free Tier
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
                        <th className="px-4 py-3 text-center">สถานะ Free Quota (50k reads/วัน)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {usageStats.dailyStats.map((item) => {
                        const isOverReads = item.reads > pricingConfig.freeDailyReads;
                        return (
                          <tr key={item.date} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-2.5 font-medium font-mono text-slate-800">{item.date}</td>
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
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">เกินโควตาฟรี</span>
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

          {/* Budget Planning & Simulator */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-850 to-indigo-950 text-white rounded-2xl shadow-md p-6 md:p-8 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-700/80 pb-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-300 flex items-center justify-center">
                  <Calculator className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-white">
                      เครื่องมือวางแผนและจำลองงบประมาณ (Budget Planning & Capacity Simulator)
                    </h2>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/30 text-amber-200 border border-amber-400/30">
                      แบบจำลองประมาณการ
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    กำหนดตัวแปรขนาดโรงเรียนเพื่อคำนวณและประเมินค่าใช้จ่ายฐานข้อมูล Google Cloud Firestore ล่วงหน้า
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-amber-300 font-medium">
                <Coins className="w-4 h-4" />
                <span>อัตราแลกเปลี่ยนอ้างอิง: 1 USD ≈ {pricingConfig.thbExchangeRate} THB</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Controls: Sliders for School Simulation */}
              <div className="lg:col-span-6 space-y-5">
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  กำหนดตัวแปรจำลองการใช้งานในโรงเรียน
                </h3>

                {/* Slider 1: Teachers Count */}
                <div className="space-y-2 bg-slate-800/60 p-3.5 rounded-xl border border-slate-700/60">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">จำนวนครูผู้สอนในระบบ:</span>
                    <span className="font-mono font-bold text-amber-300 text-sm">{simTeachersCount} คน</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="400"
                    step="5"
                    value={simTeachersCount}
                    onChange={(e) => setSimTeachersCount(Number(e.target.value))}
                    className="w-full accent-amber-400 h-2 bg-slate-700 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Slider 2: Students Count */}
                <div className="space-y-2 bg-slate-800/60 p-3.5 rounded-xl border border-slate-700/60">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">จำนวนนักเรียน/ผู้เปิดดูตารางเรียน:</span>
                    <span className="font-mono font-bold text-blue-300 text-sm">{simStudentsCount.toLocaleString()} คน</span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="6000"
                    step="100"
                    value={simStudentsCount}
                    onChange={(e) => setSimStudentsCount(Number(e.target.value))}
                    className="w-full accent-blue-400 h-2 bg-slate-700 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Slider 3: Daily Schedule Updates */}
                <div className="space-y-2 bg-slate-800/60 p-3.5 rounded-xl border border-slate-700/60">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">ความถี่การแก้ไข/ปรับตารางสอนต่อวัน:</span>
                    <span className="font-mono font-bold text-emerald-300 text-sm">{simDailyScheduleUpdates} ครั้ง/วัน</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    step="5"
                    value={simDailyScheduleUpdates}
                    onChange={(e) => setSimDailyScheduleUpdates(Number(e.target.value))}
                    className="w-full accent-emerald-400 h-2 bg-slate-700 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* Results: Financial & Budget Projection Display */}
              <div className="lg:col-span-6 flex flex-col justify-between bg-slate-800/80 p-5 md:p-6 rounded-xl border border-slate-700">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-slate-200">ผลการประเมินงบประมาณ (Budget Projection)</h3>
                    {simulationResult.isFreeTierCovered ? (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        🟢 ครอบคลุมในโควตาฟรี (100% Free)
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        🟡 มีค่าบริการส่วนเกิน
                      </span>
                    )}
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="flex justify-between py-2 border-b border-slate-700 text-slate-300">
                      <span>ประมาณการ Reads ต่อวัน:</span>
                      <span className="font-mono font-bold text-white">
                        {simulationResult.estimatedDailyReads.toLocaleString()} reads / 50,000 โควตาฟรี ({simulationResult.readCapacityUsedPercent}%)
                      </span>
                    </div>

                    <div className="flex justify-between py-2 border-b border-slate-700 text-slate-300">
                      <span>ประมาณการ Writes ต่อวัน:</span>
                      <span className="font-mono font-bold text-white">
                        {simulationResult.estimatedDailyWrites.toLocaleString()} writes / 20,000 โควตาฟรี ({simulationResult.writeCapacityUsedPercent}%)
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 pt-3">
                      <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700 text-center">
                        <span className="text-[11px] text-slate-400 block">ค่าใช้จ่ายต่อวัน</span>
                        <span className="text-lg font-bold font-mono text-white mt-0.5 block">
                          {simulationResult.dailyCostThb.toFixed(2)} ฿
                        </span>
                      </div>
                      <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700 text-center">
                        <span className="text-[11px] text-slate-400 block">ต่อภาคเรียน (4.5 ด.)</span>
                        <span className="text-lg font-bold font-mono text-amber-300 mt-0.5 block">
                          {simulationResult.semesterCostThb.toFixed(2)} ฿
                        </span>
                      </div>
                      <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-700 text-center">
                        <span className="text-[11px] text-slate-400 block">ตลอดทั้งปี (12 ด.)</span>
                        <span className="text-lg font-bold font-mono text-emerald-400 mt-0.5 block">
                          {simulationResult.annualCostThb.toFixed(2)} ฿
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-slate-900/60 rounded-lg text-[11px] text-slate-400 flex items-start gap-2 border border-slate-800">
                  <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <span>
                    คำนวณตามอัตราค่าบริการมาตรฐาน Google Cloud Firestore Spark Plan (Free Tier: 50k reads, 20k writes, 1 GiB storage ต่อวัน)
                  </span>
                </div>
              </div>
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
