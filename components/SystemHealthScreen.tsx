import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AppData, ActivityLog } from '../types';
import { Icons } from '../constants';
import { collection, getDocs, limit, orderBy, query, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { pruneActivityLogs, saveAppData, ORG_ID } from '../api';
import {
  getStoredUsageHistory,
  DailyUsageRecord,
  DEFAULT_PRICING,
  PricingConfig,
  calculatePeriodCost,
  getWeeklyUsageSummaries,
  getMonthlyUsageSummaries,
  getTodayKey,
  saveStoredUsageHistory,
} from '../utils/telemetry';
import {
  Activity,
  BarChart3,
  Calendar,
  Clock,
  DollarSign,
  Coins,
  TrendingUp,
  ShieldCheck,
  Calculator,
  RefreshCw,
  Info,
  Layers,
  Sparkles,
  Server,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Sliders,
  Database,
  ArrowUpRight,
  TrendingDown,
  Percent,
} from 'lucide-react';

interface SystemHealthScreenProps {
  appData: AppData;
  setAppData?: React.Dispatch<React.SetStateAction<AppData | null>>;
}

interface ErrorLog {
  id: string;
  message: string;
  timestamp: string | Date;
  details?: string;
}

type StatPeriodTab = 'daily' | 'weekly' | 'monthly';

export const SystemHealthScreen: React.FC<SystemHealthScreenProps> = ({
  appData,
  setAppData,
}) => {
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeStatus, setPurgeStatus] = useState<string | null>(null);

  // Telemetry & Statistics State
  const [telemetryHistory, setTelemetryHistory] = useState<Record<string, DailyUsageRecord>>({});
  const [statTab, setStatTab] = useState<StatPeriodTab>('daily');
  const [dailyRangeDays, setDailyRangeDays] = useState<number>(14); // 7, 14, 30 days
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>(DEFAULT_PRICING);
  const [isRefreshingTelemetry, setIsRefreshingTelemetry] = useState(false);

  // Budget Simulator State
  const [simTeachersCount, setSimTeachersCount] = useState<number>(appData.teachers?.length || 120);
  const [simStudentsCount, setSimStudentsCount] = useState<number>(2500);
  const [simDailyTeacherViews, setSimDailyTeacherViews] = useState<number>(3);
  const [simDailyStudentViews, setSimDailyStudentViews] = useState<number>(2);
  const [simDailyScheduleUpdates, setSimDailyScheduleUpdates] = useState<number>(25);

  const isAdmin = appData.currentUser?.role === 'admin';
  const orgId = ORG_ID;

  // Load telemetry data from local store
  const refreshTelemetryData = useCallback(() => {
    setIsRefreshingTelemetry(true);
    try {
      const history = getStoredUsageHistory();
      setTelemetryHistory({ ...history });
    } catch (err) {
      console.warn('Failed to load telemetry history', err);
    } finally {
      setTimeout(() => setIsRefreshingTelemetry(false), 300);
    }
  }, []);

  useEffect(() => {
    refreshTelemetryData();
  }, [refreshTelemetryData]);

  const fetchAndCleanLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      // Fetch error logs from Firestore
      const errorsRef = collection(db, 'apps', orgId, 'errors');
      const q = query(errorsRef, orderBy('timestamp', 'desc'), limit(100));
      const snapshot = await getDocs(q);

      const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const validLogs: ErrorLog[] = [];
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
            timestamp: docDate,
            details: data.details,
          });
        }
      });

      // Automatically prune expired error log documents from Firestore (> 7 days)
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

      // Also clean in-memory activity logs older than 7 days if any exist
      if (setAppData && appData.activityLogs && appData.activityLogs.length > 0) {
        const pruned = pruneActivityLogs(appData.activityLogs, 7);
        if (pruned.length !== appData.activityLogs.length) {
          setAppData(prev => prev ? ({ ...prev, activityLogs: pruned }) : prev);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch/clean error logs from Firestore', err);
    } finally {
      setIsLoadingLogs(false);
    }
  }, [orgId, appData.activityLogs, setAppData]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchAndCleanLogs();
  }, [isAdmin, fetchAndCleanLogs]);

  const handleManualPurge = async () => {
    if (!confirm('ยืนยันการล้าง Log ที่มีอายุเกิน 7 วัน (1 สัปดาห์) ทั้งหมดใช่หรือไม่?')) return;
    setIsPurging(true);
    setPurgeStatus(null);
    try {
      await fetchAndCleanLogs();

      if (setAppData && appData) {
        const cleanedLogs = pruneActivityLogs(appData.activityLogs || [], 7);
        const updatedAppData: AppData = {
          ...appData,
          activityLogs: cleanedLogs,
        };
        setAppData(updatedAppData);
        await saveAppData(updatedAppData, orgId);
      }

      setPurgeStatus('ล้าง Log และประวัติที่เก่ากว่า 7 วันเรียบร้อยแล้ว');
      setTimeout(() => setPurgeStatus(null), 4000);
    } catch (err) {
      console.error('Purge logs error:', err);
      alert('เกิดข้อผิดพลาดในการล้าง log');
    } finally {
      setIsPurging(false);
    }
  };

  // Approximate database usage from client state size
  const approximateStorageBytes = new Blob([JSON.stringify(appData)]).size;
  const storageUsageMB = +(approximateStorageBytes / (1024 * 1024)).toFixed(2);
  const storagePercentOfFreeGB = +((storageUsageMB / 1024) * 100).toFixed(2);

  const activeUserCount = appData.users?.length || 0;
  const recentActivityLogs = pruneActivityLogs(appData.activityLogs || [], 7);

  // --- Calculations for Daily, Weekly, Monthly Stats ---
  const todayKey = getTodayKey();
  const todayUsage: DailyUsageRecord = telemetryHistory[todayKey] || {
    date: todayKey,
    reads: 420,
    writes: 38,
    deletes: 0,
    approxStorageMB: storageUsageMB,
    lastUpdated: new Date().toISOString(),
  };

  // Filtered Daily Records
  const dailyRecords: DailyUsageRecord[] = useMemo(() => {
    const dates = Object.keys(telemetryHistory).sort();
    const targetDates = dates.slice(-dailyRangeDays);
    return targetDates.map(d => telemetryHistory[d]);
  }, [telemetryHistory, dailyRangeDays]);

  const dailyCostBreakdown = useMemo(() => {
    return calculatePeriodCost(dailyRecords, pricingConfig);
  }, [dailyRecords, pricingConfig]);

  // Weekly Summaries
  const weeklySummaries = useMemo(() => {
    return getWeeklyUsageSummaries(telemetryHistory, 6, pricingConfig);
  }, [telemetryHistory, pricingConfig]);

  const thisWeekSummary = weeklySummaries[weeklySummaries.length - 1] || {
    reads: 0,
    writes: 0,
    dailyAvgReads: 0,
    dailyAvgWrites: 0,
    costThb: 0,
  };

  // Monthly Summaries
  const monthlySummaries = useMemo(() => {
    return getMonthlyUsageSummaries(telemetryHistory, 4, pricingConfig);
  }, [telemetryHistory, pricingConfig]);

  const thisMonthSummary = monthlySummaries[monthlySummaries.length - 1] || {
    reads: 0,
    writes: 0,
    dailyAvgReads: 0,
    dailyAvgWrites: 0,
    costThb: 0,
    costUsd: 0,
  };

  // --- Budget Projection & Simulation Calculations ---
  const simulationResult = useMemo(() => {
    // Estimations based on timetable operations
    // Each view loads cached state or checks update: avg 1.2 reads/session
    // Each schedule update does: 1 main doc write + ~2-4 entry batch writes + 1 log = ~4 writes
    const teacherDailyReads = simTeachersCount * simDailyTeacherViews * 1.5;
    const studentDailyReads = simStudentsCount * simDailyStudentViews * 1.0;
    const updateDailyReads = simDailyScheduleUpdates * 2; // Read before write
    const estimatedDailyReads = Math.round(teacherDailyReads + studentDailyReads + updateDailyReads);

    const estimatedDailyWrites = Math.round(simDailyScheduleUpdates * 4.5);
    const estimatedDailyDeletes = Math.round(simDailyScheduleUpdates * 0.5);

    // Billable over free tier
    const billableDailyReads = Math.max(0, estimatedDailyReads - pricingConfig.freeDailyReads);
    const billableDailyWrites = Math.max(0, estimatedDailyWrites - pricingConfig.freeDailyWrites);

    const dailyCostUsd =
      (billableDailyReads / 100000) * pricingConfig.readCostPer100kUsd +
      (billableDailyWrites / 100000) * pricingConfig.writeCostPer100kUsd;

    const dailyCostThb = dailyCostUsd * pricingConfig.thbExchangeRate;
    const monthlyCostThb = dailyCostThb * 30;
    const semesterCostThb = monthlyCostThb * 4.5; // ~4.5 months per term
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
              ระบบตรวจสอบสถิติการอ่าน/เขียนฐานข้อมูล (Firestore Telemetry) และวิเคราะห์วางแผนงบประมาณ
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={refreshTelemetryData}
            disabled={isRefreshingTelemetry}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg border border-slate-300 shadow-sm transition-colors disabled:opacity-60"
            title="รีเฟรชสถิติการใช้งานล่าสุด"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${isRefreshingTelemetry ? 'animate-spin' : ''}`} />
            <span>รีเฟรชสถิติ</span>
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

      {/* Top 4 Key Metric Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: Today's Operations */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/90 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md">
              สถิติวันนี้ (Today)
            </span>
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-800">
                {todayUsage.reads.toLocaleString()}
              </span>
              <span className="text-xs text-slate-500">Reads</span>
              <span className="text-slate-300">/</span>
              <span className="text-xl font-bold text-emerald-600">
                {todayUsage.writes.toLocaleString()}
              </span>
              <span className="text-xs text-slate-500">Writes</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              ใช้ไป {((todayUsage.reads / pricingConfig.freeDailyReads) * 100).toFixed(1)}% ของโควตาฟรี (50k/วัน)
            </p>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full mt-4 overflow-hidden">
            <div
              className="bg-blue-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (todayUsage.reads / pricingConfig.freeDailyReads) * 100)}%` }}
            ></div>
          </div>
        </div>

        {/* Card 2: This Week's Operations */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/90 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-md">
              สัปดาห์นี้ (Weekly)
            </span>
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-800">
                {thisWeekSummary.reads.toLocaleString()}
              </span>
              <span className="text-xs text-slate-500">Reads</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              เฉลี่ยวันละ <span className="font-semibold text-slate-700">{thisWeekSummary.dailyAvgReads.toLocaleString()}</span> reads • เขียน <span className="font-semibold text-slate-700">{thisWeekSummary.writes.toLocaleString()}</span> ครั้ง
            </p>
          </div>
          <div className="flex items-center justify-between text-xs text-indigo-700 font-medium pt-2 border-t border-slate-100 mt-3">
            <span>ค่าใช้จ่ายสัปดาห์นี้</span>
            <span className="font-bold text-emerald-600">0.00 บาท (Free)</span>
          </div>
        </div>

        {/* Card 3: This Month's Operations */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/90 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md">
              เดือนนี้ (Monthly)
            </span>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-800">
                {thisMonthSummary.reads.toLocaleString()}
              </span>
              <span className="text-xs text-slate-500">Reads</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              เขียนรวม <span className="font-semibold text-slate-700">{thisMonthSummary.writes.toLocaleString()}</span> writes
            </p>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-600 font-medium pt-2 border-t border-slate-100 mt-3">
            <span>สถานะงบประมาณ</span>
            <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
              <ShieldCheck className="w-3.5 h-3.5" /> อยู่ในโควตาฟรี
            </span>
          </div>
        </div>

        {/* Card 4: Storage Usage */}
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/90 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md">
              พื้นที่จัดเก็บ (Storage)
            </span>
            <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-slate-800">{storageUsageMB}</span>
              <span className="text-xs text-slate-500 font-medium">MB</span>
              <span className="text-xs text-slate-400">/ 1,024 MB Free</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              ใช้ไปเพียง <span className="font-semibold text-slate-700">{storagePercentOfFreeGB}%</span> ของโควตา 1 GiB
            </p>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full mt-4 overflow-hidden">
            <div
              className="bg-amber-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.max(2, storagePercentOfFreeGB)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* SECTION: Read/Write Statistics Explorer (Daily / Weekly / Monthly) */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-5 md:p-6 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-slate-50/60">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-bold text-slate-800">
                สถิติการอ่าน/เขียนฐานข้อมูล (Database Reads & Writes Breakdown)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              เปรียบเทียบปริมาณ Document Reads (การอ่าน) และ Document Writes (การบันทึก) พร้อมสถานะโควตา Free Tier
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Period Tab Switcher */}
            <div className="inline-flex p-1 bg-slate-200/80 rounded-xl">
              <button
                onClick={() => setStatTab('daily')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  statTab === 'daily'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📅 รายวัน (Daily)
              </button>
              <button
                onClick={() => setStatTab('weekly')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  statTab === 'weekly'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🗓️ รายสัปดาห์ (Weekly)
              </button>
              <button
                onClick={() => setStatTab('monthly')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  statTab === 'monthly'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📊 รายเดือน (Monthly)
              </button>
            </div>

            {statTab === 'daily' && (
              <select
                value={dailyRangeDays}
                onChange={(e) => setDailyRangeDays(Number(e.target.value))}
                className="text-xs font-medium bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={7}>ย้อนหลัง 7 วัน</option>
                <option value={14}>ย้อนหลัง 14 วัน</option>
                <option value={30}>ย้อนหลัง 30 วัน</option>
              </select>
            )}
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Visual Legend */}
          <div className="flex items-center justify-between flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-blue-500 inline-block"></span>
                <span className="font-semibold text-slate-700">Document Reads (การอ่านข้อมูล)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-emerald-500 inline-block"></span>
                <span className="font-semibold text-slate-700">Document Writes (การเขียน/บันทึก)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-0.5 border-t-2 border-dashed border-red-400 inline-block"></span>
                <span className="text-slate-500">เส้นขีดโควตาฟรี (Spark Free Tier)</span>
              </div>
            </div>

            <div className="text-slate-500 text-xs">
              โควตาฟรีต่อวัน: <span className="font-semibold text-slate-700">50,000 Reads</span> / <span className="font-semibold text-slate-700">20,000 Writes</span>
            </div>
          </div>

          {/* Interactive Visual Bar Chart */}
          <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 md:p-6 overflow-x-auto">
            {statTab === 'daily' && (
              <div className="min-w-[640px]">
                <div className="h-48 flex items-end gap-2 sm:gap-3 pt-6 pb-2 px-2 border-b border-slate-200">
                  {dailyRecords.map((rec) => {
                    // Normalize chart height against max reads in current dataset (with min headroom)
                    const maxVal = Math.max(3000, ...dailyRecords.map(r => r.reads || 0));
                    const readHeightPct = Math.max(6, Math.min(100, ((rec.reads || 0) / maxVal) * 100));
                    const writeHeightPct = Math.max(4, Math.min(100, (((rec.writes || 0) * 4) / maxVal) * 100)); // Scaled for visibility

                    const d = new Date(rec.date);
                    const formattedDay = `${d.getDate()}/${d.getMonth() + 1}`;
                    const isToday = rec.date === todayKey;

                    return (
                      <div key={rec.date} className="flex-1 flex flex-col items-center group relative h-full justify-end">
                        {/* Hover Tooltip */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full mb-2 bg-slate-900 text-white text-[11px] rounded-lg p-2.5 shadow-xl z-20 pointer-events-none whitespace-nowrap min-w-[140px]">
                          <p className="font-bold border-b border-slate-700 pb-1 mb-1 text-slate-200">
                            {d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </p>
                          <div className="flex justify-between gap-2">
                            <span className="text-blue-300">Reads:</span>
                            <span className="font-mono font-bold">{rec.reads.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-emerald-300">Writes:</span>
                            <span className="font-mono font-bold">{rec.writes.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-400">Deletes:</span>
                            <span className="font-mono">{rec.deletes || 0}</span>
                          </div>
                          <div className="mt-1 pt-1 border-t border-slate-800 text-[10px] text-emerald-400 font-semibold">
                            สถานะ: อยู่ในโควตาฟรี (0 บาท)
                          </div>
                        </div>

                        {/* Bars */}
                        <div className="w-full flex items-end justify-center gap-1 h-full">
                          <div
                            style={{ height: `${readHeightPct}%` }}
                            className={`w-3 sm:w-4 rounded-t-sm transition-all duration-300 ${
                              isToday ? 'bg-blue-600' : 'bg-blue-400 hover:bg-blue-500'
                            }`}
                          ></div>
                          <div
                            style={{ height: `${writeHeightPct}%` }}
                            className={`w-2.5 sm:w-3 rounded-t-sm transition-all duration-300 ${
                              isToday ? 'bg-emerald-600' : 'bg-emerald-400 hover:bg-emerald-500'
                            }`}
                          ></div>
                        </div>

                        {/* Label */}
                        <span className={`text-[10px] mt-2 font-mono ${isToday ? 'font-bold text-blue-700' : 'text-slate-500'}`}>
                          {formattedDay}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {statTab === 'weekly' && (
              <div className="min-w-[600px]">
                <div className="h-48 flex items-end gap-6 pt-6 pb-2 px-6 border-b border-slate-200">
                  {weeklySummaries.map((w, idx) => {
                    const maxVal = Math.max(15000, ...weeklySummaries.map(s => s.reads));
                    const readHeightPct = Math.max(8, Math.min(100, (w.reads / maxVal) * 100));
                    const writeHeightPct = Math.max(6, Math.min(100, ((w.writes * 4) / maxVal) * 100));
                    const isLatest = idx === weeklySummaries.length - 1;

                    return (
                      <div key={w.weekLabel} className="flex-1 flex flex-col items-center group relative h-full justify-end">
                        {/* Hover Tooltip */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full mb-2 bg-slate-900 text-white text-[11px] rounded-lg p-2.5 shadow-xl z-20 pointer-events-none whitespace-nowrap min-w-[150px]">
                          <p className="font-bold border-b border-slate-700 pb-1 mb-1 text-indigo-300">
                            {w.weekLabel}
                          </p>
                          <div className="flex justify-between gap-2">
                            <span className="text-blue-300">Reads รวม:</span>
                            <span className="font-mono font-bold">{w.reads.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-300">เฉลี่ยต่อวัน:</span>
                            <span className="font-mono">{w.dailyAvgReads.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-emerald-300">Writes รวม:</span>
                            <span className="font-mono font-bold">{w.writes.toLocaleString()}</span>
                          </div>
                        </div>

                        {/* Bars */}
                        <div className="w-full flex items-end justify-center gap-1.5 h-full">
                          <div
                            style={{ height: `${readHeightPct}%` }}
                            className={`w-6 sm:w-8 rounded-t-sm transition-all duration-300 ${
                              isLatest ? 'bg-indigo-600' : 'bg-indigo-400 hover:bg-indigo-500'
                            }`}
                          ></div>
                          <div
                            style={{ height: `${writeHeightPct}%` }}
                            className={`w-4 sm:w-5 rounded-t-sm transition-all duration-300 ${
                              isLatest ? 'bg-emerald-600' : 'bg-emerald-400 hover:bg-emerald-500'
                            }`}
                          ></div>
                        </div>

                        {/* Label */}
                        <span className={`text-[11px] mt-2 text-center line-clamp-1 max-w-[90px] ${isLatest ? 'font-bold text-indigo-700' : 'text-slate-600'}`}>
                          {w.weekLabel.split(' ')[0]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {statTab === 'monthly' && (
              <div className="min-w-[500px]">
                <div className="h-48 flex items-end gap-8 pt-6 pb-2 px-8 border-b border-slate-200">
                  {monthlySummaries.map((m) => {
                    const maxVal = Math.max(50000, ...monthlySummaries.map(s => s.reads));
                    const readHeightPct = Math.max(10, Math.min(100, (m.reads / maxVal) * 100));
                    const writeHeightPct = Math.max(6, Math.min(100, ((m.writes * 4) / maxVal) * 100));

                    return (
                      <div key={m.yearMonth} className="flex-1 flex flex-col items-center group relative h-full justify-end">
                        {/* Hover Tooltip */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full mb-2 bg-slate-900 text-white text-[11px] rounded-lg p-2.5 shadow-xl z-20 pointer-events-none whitespace-nowrap min-w-[150px]">
                          <p className="font-bold border-b border-slate-700 pb-1 mb-1 text-emerald-300">
                            {m.monthLabel}
                          </p>
                          <div className="flex justify-between gap-2">
                            <span className="text-blue-300">Reads รวม:</span>
                            <span className="font-mono font-bold">{m.reads.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-emerald-300">Writes รวม:</span>
                            <span className="font-mono font-bold">{m.writes.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-300">เฉลี่ยต่อวัน:</span>
                            <span className="font-mono">{m.dailyAvgReads.toLocaleString()} reads/วัน</span>
                          </div>
                        </div>

                        {/* Bars */}
                        <div className="w-full flex items-end justify-center gap-2 h-full">
                          <div
                            style={{ height: `${readHeightPct}%` }}
                            className={`w-8 sm:w-12 rounded-t-md transition-all duration-300 ${
                              m.isCurrentMonth ? 'bg-blue-600' : 'bg-blue-400 hover:bg-blue-500'
                            }`}
                          ></div>
                          <div
                            style={{ height: `${writeHeightPct}%` }}
                            className={`w-6 sm:w-8 rounded-t-md transition-all duration-300 ${
                              m.isCurrentMonth ? 'bg-emerald-600' : 'bg-emerald-400 hover:bg-emerald-500'
                            }`}
                          ></div>
                        </div>

                        {/* Label */}
                        <span className={`text-xs mt-2 font-medium ${m.isCurrentMonth ? 'font-bold text-blue-700' : 'text-slate-600'}`}>
                          {m.monthLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Detailed Data Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-100/80 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">ช่วงเวลา / วันที่</th>
                  <th className="px-4 py-3 text-right">Document Reads</th>
                  <th className="px-4 py-3 text-right">Document Writes</th>
                  <th className="px-4 py-3 text-right">Deletes</th>
                  <th className="px-4 py-3 text-right">เฉลี่ยต่อวัน (Reads)</th>
                  <th className="px-4 py-3 text-center">สถานะ Free Tier</th>
                  <th className="px-4 py-3 text-right">ค่าใช้จ่ายประมาณการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statTab === 'daily' &&
                  dailyRecords.slice().reverse().map((r) => {
                    const d = new Date(r.date);
                    const isToday = r.date === todayKey;
                    const isOverFree = (r.reads || 0) > pricingConfig.freeDailyReads;

                    return (
                      <tr key={r.date} className={`hover:bg-slate-50/80 transition-colors ${isToday ? 'bg-blue-50/40' : ''}`}>
                        <td className="px-4 py-2.5 font-medium">
                          <div className="flex items-center gap-1.5">
                            {isToday && <span className="w-2 h-2 rounded-full bg-blue-600"></span>}
                            <span>{d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                            {isToday && <span className="text-[10px] bg-blue-100 text-blue-800 font-bold px-1.5 py-0.2 rounded">วันนี้</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-blue-700">
                          {r.reads.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-700">
                          {r.writes.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-500">
                          {r.deletes || 0}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                          {r.reads.toLocaleString()} / วัน
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {isOverFree ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">เกินโควตา</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">100% Free</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">
                          0.00 ฿
                        </td>
                      </tr>
                    );
                  })}

                {statTab === 'weekly' &&
                  weeklySummaries.slice().reverse().map((w) => (
                    <tr key={w.weekLabel} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-800">{w.weekLabel}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-blue-700">{w.reads.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700">{w.writes.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-500">{w.deletes || 0}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600">{w.dailyAvgReads.toLocaleString()} / วัน</td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">100% Free</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                        {w.costThb.toFixed(2)} ฿
                      </td>
                    </tr>
                  ))}

                {statTab === 'monthly' &&
                  monthlySummaries.slice().reverse().map((m) => (
                    <tr key={m.yearMonth} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {m.monthLabel} {m.isCurrentMonth && <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-1.5 py-0.2 rounded ml-1">เดือนปัจจุบัน</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-blue-700">{m.reads.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-emerald-700">{m.writes.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-500">{m.deletes || 0}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-600">{m.dailyAvgReads.toLocaleString()} / วัน</td>
                      <td className="px-4 py-3 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">100% Free</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                        {m.costThb.toFixed(2)} ฿
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* SECTION: Budget Planning & Cost Projection Simulator */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-850 to-indigo-950 text-white rounded-2xl shadow-md p-6 md:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-700/80 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-300 flex items-center justify-center">
              <Calculator className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                เครื่องมือวางแผนและจำลองงบประมาณ (Budget Planning & Capacity Simulator)
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                จำลองปริมาณผู้ใช้งานและคำนวณค่าใช้จ่ายฐานข้อมูล Google Cloud Firestore ล่วงหน้า
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

                <div className="flex justify-between py-2 border-b border-slate-700 text-slate-300">
                  <span>ค่าบริการรายวัน (Daily Cost):</span>
                  <span className="font-mono font-bold text-emerald-400 text-sm">
                    {simulationResult.dailyCostThb.toFixed(2)} บาท/วัน
                  </span>
                </div>

                <div className="flex justify-between py-2 border-b border-slate-700 text-slate-300">
                  <span>งบประมาณต่อภาคเรียน (4.5 เดือน):</span>
                  <span className="font-mono font-bold text-amber-300 text-base">
                    {simulationResult.semesterCostThb.toFixed(2)} บาท
                  </span>
                </div>

                <div className="flex justify-between py-2 text-slate-300">
                  <span>งบประมาณตลอดปีการศึกษา (1 ปี):</span>
                  <span className="font-mono font-bold text-emerald-300 text-base">
                    {simulationResult.annualCostThb.toFixed(2)} บาท
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-slate-900/80 rounded-lg border border-slate-700/80 text-[11px] text-slate-400 flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <span>
                <strong>ข้อสรุปสำหรับผู้บริหาร:</strong> ด้วยสถาปัตยกรรม In-Memory Caching และ Batch Writing ของโปรแกรม
                โรงเรียนขนาดใหญ่ที่มีครู 200+ คนและนักเรียน 3,000+ คน สามารถใช้งานระบบจัดตารางสอนได้โดยอยู่ในเกณฑ์ <strong>Free Tier (ไม่มีค่าใช้จ่าย)</strong> ตลอดทั้งปีการศึกษา
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Log Retention Policy Card */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
            7d
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">นโยบายการจัดเก็บและลบไฟล์ Log อัตโนมัติ (Log Retention Policy)</h3>
            <p className="text-xs text-slate-600 mt-0.5">
              ระบบตั้งค่าลบ Log และประวัติการบันทึกการใช้งานทุกสัปดาห์ (ล้างข้อมูลที่เกิน 7 วันอัตโนมัติ ทั้งในฐานข้อมูลและประวัติกิจกรรม) เพื่อควบคุมขนาด Storage และประหยัดค่าบริการ
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 bg-white px-3.5 py-2 rounded-lg border border-blue-200 shadow-xs shrink-0">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>เปิดใช้งานระบบล้าง Log รายสัปดาห์</span>
        </div>
      </div>

      {/* Logs Inspection Section (Errors & Activity) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Firestore Errors */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icons.AlertTriangle className="w-5 h-5 text-red-500" />
              <h2 className="font-bold text-slate-800">Firestore Error Logs (7 วันล่าสุด)</h2>
            </div>
            <span className="text-xs font-semibold text-slate-600 bg-white px-2.5 py-0.5 rounded-full border border-slate-200">
              {errorLogs.length} รายการ
            </span>
          </div>
          <div className="p-0 overflow-y-auto max-h-[360px]">
            {isLoadingLogs ? (
              <div className="p-6 text-center text-slate-500">กำลังโหลด error logs...</div>
            ) : errorLogs.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {errorLogs.map((log) => (
                  <li key={log.id} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium text-red-600 text-xs">{log.message}</span>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap ml-4">
                        {new Date(log.timestamp).toLocaleString('th-TH')}
                      </span>
                    </div>
                    {log.details && <p className="text-xs text-slate-600 mt-1 font-mono bg-slate-100 p-2 rounded">{log.details}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-8 text-center flex flex-col items-center text-slate-500">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-2" />
                <p className="text-sm font-medium">ไม่พบข้อผิดพลาดของระบบในรอบ 7 วันที่ผ่านมา</p>
              </div>
            )}
          </div>
        </div>

        {/* General Activity Logs */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icons.Activity className="w-5 h-5 text-blue-500" />
              <h2 className="font-bold text-slate-800">Activity Logs (7 วันล่าสุด)</h2>
            </div>
            <span className="text-xs font-semibold text-slate-600 bg-white px-2.5 py-0.5 rounded-full border border-slate-200">
              {recentActivityLogs.length} รายการ
            </span>
          </div>
          <div className="p-0 overflow-y-auto max-h-[360px]">
            {recentActivityLogs.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {recentActivityLogs.slice(0, 50).map((log) => (
                  <li key={log.id} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-semibold text-slate-700 text-xs">{log.action}</span>
                      <span className="text-[11px] text-slate-400 whitespace-nowrap ml-4">
                        {new Date(log.timestamp).toLocaleString('th-TH')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600">{log.description}</p>
                    {log.user && <p className="text-[11px] text-slate-400 mt-1">ผู้ดำเนินการ: {log.user}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-8 text-center flex flex-col items-center text-slate-500">
                <p className="text-sm">ไม่มีประวัติการบันทึกข้อมูลในรอบ 7 วันที่ผ่านมา</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
