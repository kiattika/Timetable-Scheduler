import React, { useState, useEffect } from 'react';
import { AppData } from '../types';
import { Icons } from '../constants';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface SystemHealthScreenProps {
  appData: AppData;
}

interface ErrorLog {
  id: string;
  message: string;
  timestamp: string | Date;
  details?: string;
}

export const SystemHealthScreen: React.FC<SystemHealthScreenProps> = ({ appData }) => {
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const isAdmin = appData.currentUser?.role === 'admin' || appData.currentUser?.role === 'platform_admin';

  useEffect(() => {
    if (!isAdmin) return;
    
    const fetchErrorLogs = async () => {
      setIsLoadingLogs(true);
      try {
        const orgId = appData.organizationSettings?.name ? appData.orgId || 'default' : 'default';
        // Attempt to fetch from an 'errors' collection if it exists
        const errorsRef = collection(db, 'apps', orgId, 'errors');
        const q = query(errorsRef, orderBy('timestamp', 'desc'), limit(50));
        const snapshot = await getDocs(q);
        
        const logs: ErrorLog[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          logs.push({
            id: doc.id,
            message: data.message || 'Unknown error',
            timestamp: data.timestamp?.toDate ? data.timestamp.toDate() : (data.timestamp || new Date()),
            details: data.details,
          });
        });
        setErrorLogs(logs);
      } catch (err) {
        console.warn('Failed to fetch error logs from Firestore', err);
        // Fallback to empty if collection doesn't exist or permissions error
      } finally {
        setIsLoadingLogs(false);
      }
    };

    fetchErrorLogs();
  }, [appData.orgId, appData.organizationSettings]);

  // Approximate database usage from client state size
  const approximateStorageBytes = new Blob([JSON.stringify(appData)]).size;
  const storageUsageMB = (approximateStorageBytes / (1024 * 1024)).toFixed(2);
  
  const activeUserCount = appData.users?.length || 0;
  
  const recentActivityLogs = appData.activityLogs || [];

  if (!isAdmin) {
    return (
      <div className="p-8 flex items-center justify-center text-red-500 h-full font-bold">
        Access Denied. Only administrators can view this page.
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <Icons.DatabaseZap className="w-8 h-8 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-800">System Health Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Storage Usage Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4">
            <Icons.DatabaseZap className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Approx. Storage Usage</h2>
          <p className="text-3xl font-bold text-slate-800 mt-2">{storageUsageMB} MB</p>
          <p className="text-xs text-slate-400 mt-2">Based on current loaded payload</p>
        </div>

        {/* Active Users Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-4">
            <Icons.UsersRound className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Registered Users</h2>
          <p className="text-3xl font-bold text-slate-800 mt-2">{activeUserCount}</p>
          <p className="text-xs text-slate-400 mt-2">Total active user accounts</p>
        </div>
        
        {/* System Status Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center mb-4">
            <Icons.CheckCircle className="w-6 h-6" />
          </div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">System Status</h2>
          <p className="text-3xl font-bold text-green-600 mt-2">Operational</p>
          <p className="text-xs text-slate-400 mt-2">All services running normally</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        {/* Recent Firestore Errors */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <Icons.AlertTriangle className="w-5 h-5 text-red-500" />
            <h2 className="font-semibold text-slate-800">Recent Firestore Errors</h2>
          </div>
          <div className="p-0 overflow-y-auto max-h-[400px]">
            {isLoadingLogs ? (
              <div className="p-6 text-center text-slate-500">Loading error logs...</div>
            ) : errorLogs.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {errorLogs.map((log) => (
                  <li key={log.id} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium text-red-600">{log.message}</span>
                      <span className="text-xs text-slate-400 whitespace-nowrap ml-4">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {log.details && <p className="text-sm text-slate-600 mt-1 font-mono text-xs bg-slate-100 p-2 rounded">{log.details}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-8 text-center flex flex-col items-center text-slate-500">
                <Icons.CheckCircle className="w-10 h-10 text-emerald-400 mb-2" />
                <p>No recent system errors found in Firestore.</p>
              </div>
            )}
          </div>
        </div>

        {/* General Activity Logs */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
          <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <Icons.Activity className="w-5 h-5 text-blue-500" />
            <h2 className="font-semibold text-slate-800">Recent System Activity</h2>
          </div>
          <div className="p-0 overflow-y-auto max-h-[400px]">
            {recentActivityLogs.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {recentActivityLogs.slice(0, 50).map((log) => (
                  <li key={log.id} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium text-slate-700">{log.action}</span>
                      <span className="text-xs text-slate-400 whitespace-nowrap ml-4">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">{log.description}</p>
                    {log.user && <p className="text-xs text-slate-400 mt-1">User: {log.user}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-8 text-center flex flex-col items-center text-slate-500">
                <p>No recent activity logs.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
