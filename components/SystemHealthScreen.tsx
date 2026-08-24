import React, { useState, useEffect, useCallback } from 'react';
import { AppData, ActivityLog } from '../types';
import { Icons } from '../constants';
import { collection, getDocs, limit, orderBy, query, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { pruneActivityLogs, saveAppData, ORG_ID } from '../api';

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

export const SystemHealthScreen: React.FC<SystemHealthScreenProps> = ({ 
  appData,
  setAppData,
}) => {
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeStatus, setPurgeStatus] = useState<string | null>(null);

  const isAdmin = appData.currentUser?.role === 'admin';

  const orgId = ORG_ID;

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
          // Log is older than 7 days, flag for removal
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
          activityLogs: cleanedLogs
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
  const storageUsageMB = (approximateStorageBytes / (1024 * 1024)).toFixed(2);
  
  const activeUserCount = appData.users?.length || 0;
  const recentActivityLogs = pruneActivityLogs(appData.activityLogs || [], 7);

  if (!isAdmin) {
    return (
      <div className="p-8 flex items-center justify-center text-red-500 h-full font-bold">
        Access Denied. เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถดูหน้านี้ได้
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <Icons.DatabaseZap className="w-8 h-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-slate-800">System Health & Log Management</h1>
            <p className="text-sm text-slate-500">สถานะระบบและการจัดการไฟล์ Log ประวัติการใช้งาน</p>
          </div>
        </div>

        <button
          onClick={handleManualPurge}
          disabled={isPurging || isLoadingLogs}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50"
        >
          <Icons.Delete className="w-4 h-4 text-slate-300" />
          {isPurging ? 'กำลังล้าง Log...' : 'ล้าง Log เก่า (> 7 วัน) ทันที'}
        </button>
      </div>

      {purgeStatus && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm flex items-center gap-2">
          <Icons.CheckCircle className="w-4 h-4 shrink-0" />
          <span>{purgeStatus}</span>
        </div>
      )}

      {/* Log Retention Policy Card */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
            7d
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">นโยบายการจัดเก็บและลบไฟล์ Log อัตโนมัติ (Log Retention Policy)</h3>
            <p className="text-xs text-slate-600 mt-0.5">
              ระบบตั้งค่าลบ Log และประวัติการบันทึกการใช้งานทุกสัปดาห์ (ล้างข้อมูลที่เกิน 7 วันอัตโนมัติ ทั้งในฐานข้อมูลและประวัติกิจกรรม)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-blue-700 bg-white px-3 py-1.5 rounded-md border border-blue-200 shrink-0">
          <Icons.CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
          <span>เปิดใช้งานระบบลบ Log รายสัปดาห์</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Storage Usage Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4">
            <Icons.DatabaseZap className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Approx. Storage Usage</h2>
          <p className="text-3xl font-bold text-slate-800 mt-2">{storageUsageMB} MB</p>
          <p className="text-xs text-slate-400 mt-2">ขนาดข้อมูลที่โหลดในหน่วยความจำ</p>
        </div>

        {/* Active Users Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-4">
            <Icons.UsersRound className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Registered Users</h2>
          <p className="text-3xl font-bold text-slate-800 mt-2">{activeUserCount}</p>
          <p className="text-xs text-slate-400 mt-2">จำนวนบัญชีผู้ใช้ในระบบ</p>
        </div>
        
        {/* System Status Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center mb-4">
            <Icons.CheckCircle className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">System Status</h2>
          <p className="text-3xl font-bold text-green-600 mt-2">Operational</p>
          <p className="text-xs text-slate-400 mt-2">ระบบทำงานเป็นปกติ</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        {/* Recent Firestore Errors */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icons.AlertTriangle className="w-5 h-5 text-red-500" />
              <h2 className="font-semibold text-slate-800">Firestore Error Logs (7 วันล่าสุด)</h2>
            </div>
            <span className="text-xs text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
              {errorLogs.length} รายการ
            </span>
          </div>
          <div className="p-0 overflow-y-auto max-h-[400px]">
            {isLoadingLogs ? (
              <div className="p-6 text-center text-slate-500">กำลังโหลด error logs...</div>
            ) : errorLogs.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {errorLogs.map((log) => (
                  <li key={log.id} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium text-red-600">{log.message}</span>
                      <span className="text-xs text-slate-400 whitespace-nowrap ml-4">
                        {new Date(log.timestamp).toLocaleString('th-TH')}
                      </span>
                    </div>
                    {log.details && <p className="text-xs text-slate-600 mt-1 font-mono bg-slate-100 p-2 rounded">{log.details}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-8 text-center flex flex-col items-center text-slate-500">
                <Icons.CheckCircle className="w-10 h-10 text-emerald-400 mb-2" />
                <p>ไม่พบข้อผิดพลาดของระบบในรอบ 7 วันที่ผ่านมา</p>
              </div>
            )}
          </div>
        </div>

        {/* General Activity Logs */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icons.Activity className="w-5 h-5 text-blue-500" />
              <h2 className="font-semibold text-slate-800">Activity Logs (7 วันล่าสุด)</h2>
            </div>
            <span className="text-xs text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
              {recentActivityLogs.length} รายการ
            </span>
          </div>
          <div className="p-0 overflow-y-auto max-h-[400px]">
            {recentActivityLogs.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {recentActivityLogs.slice(0, 50).map((log) => (
                  <li key={log.id} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium text-slate-700">{log.action}</span>
                      <span className="text-xs text-slate-400 whitespace-nowrap ml-4">
                        {new Date(log.timestamp).toLocaleString('th-TH')}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">{log.description}</p>
                    {log.user && <p className="text-xs text-slate-400 mt-1">ผู้ดำเนินการ: {log.user}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-8 text-center flex flex-col items-center text-slate-500">
                <p>ไม่มีประวัติการบันทึกข้อมูลในรอบ 7 วันที่ผ่านมา</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

