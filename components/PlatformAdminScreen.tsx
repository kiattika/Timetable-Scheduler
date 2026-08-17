import React, { useState, useEffect } from 'react';
import { db, auth } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { AppData } from '../types';
import { User } from '../types';
import { Icons } from '../constants';
import { getInitialAppDataForApi } from '../api';

export interface Organization {
  id: string;
  name: string;
  address: string;
  status: 'Active' | 'Suspended';
}

export interface DomainMapping {
  domain: string;
  organizationId: string;
  adminEmail?: string;
}

export interface PlatformAdminData {
  organizations: Organization[];
  domainMappings: DomainMapping[];
}

interface PlatformAdminScreenProps {
  appData: AppData;
  impersonatedOrgId: string | null;
  setImpersonatedOrgId: (orgId: string | null) => void;
  onExitImpersonation: () => void;
  onReloadMainData: (orgId: string) => void;
}

export const PlatformAdminScreen: React.FC<PlatformAdminScreenProps> = ({
  appData,
  impersonatedOrgId,
  setImpersonatedOrgId,
  onExitImpersonation,
  onReloadMainData,
}) => {
  const [activeTab, setActiveTab] = useState<'orgs' | 'domains'>('orgs');
  const [platData, setPlatData] = useState<PlatformAdminData>({ organizations: [], domainMappings: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Stats
  const [totalTeachersCount, setTotalTeachersCount] = useState<number>(0);
  const [isDbOnline, setIsDbOnline] = useState<boolean>(true);

  // Org form states
  const [orgName, setOrgName] = useState('');
  const [orgAddress, setOrgAddress] = useState('');
  const [orgStatus, setOrgStatus] = useState<'Active' | 'Suspended'>('Active');

  // Domain mapping states
  const [selectedMappingOrgId, setSelectedMappingOrgId] = useState('');
  const [mappingDomain, setMappingDomain] = useState('');
  const [mappingAdminEmail, setMappingAdminEmail] = useState('');

  // Info message
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Load platform admin central configuration
  const loadPlatData = async () => {
    setIsLoading(true);
    try {
      const docRef = doc(db, 'apps', 'platform_admin_data');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const d = docSnap.data() as PlatformAdminData;
        setPlatData({
          organizations: d.organizations || [],
          domainMappings: d.domainMappings || [],
        });
      } else {
        // Initialize with default
        const initialData: PlatformAdminData = { organizations: [], domainMappings: [] };
        await setDoc(docRef, initialData);
        setPlatData(initialData);
      }
      setIsDbOnline(true);
    } catch (error) {
      console.error("Failed to load platform data:", error);
      setIsDbOnline(false);
      setNotification({ type: 'error', message: 'ไม่สามารถติดต่อฐานข้อมูลเพื่อโหลดการตั้งค่าระบบส่วนกลางได้' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPlatData();
  }, []);

  // Fetch count of teachers across all registered organizations
  useEffect(() => {
    if (platData.organizations.length === 0) {
      setTotalTeachersCount(0);
      return;
    }

    const fetchTeachers = async () => {
      let total = 0;
      for (const org of platData.organizations) {
        try {
          const orgDocRef = doc(db, 'apps', org.id);
          const orgSnap = await getDoc(orgDocRef);
          if (orgSnap.exists()) {
            const data = orgSnap.data();
            if (data && data.teachers) {
              total += (data.teachers as any[]).length;
            }
          }
        } catch (e) {
          console.error(`Failed to fetch teachers for ${org.id}:`, e);
        }
      }
      setTotalTeachersCount(total);
    };

    fetchTeachers();
  }, [platData.organizations]);

  const savePlatDataToDb = async (newData: PlatformAdminData, successMessage: string = 'บันทึกการตั้งค่าระบบส่วนกลางสำเร็จ!') => {
    setIsSaving(true);
    try {
      const docRef = doc(db, 'apps', 'platform_admin_data');
      // Clean undefined values before saving to Firestore
      const cleanData = JSON.parse(JSON.stringify(newData));
      await setDoc(docRef, cleanData);
      setPlatData(cleanData);
      setNotification({ type: 'success', message: successMessage });
      setTimeout(() => setNotification(null), 4000);
    } catch (error) {
      console.error("Save platform settings failed:", error);
      setNotification({ type: 'error', message: 'ล้มเหลวในการบันทึกการตั้งค่าลงฐานข้อมูล' });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setIsSaving(false);
    }
  };

  // Register New Organization/School
  const handleRegisterOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) {
      setNotification({ type: 'error', message: 'กรุณากรอกชื่อสถาบันการศึกษา' });
      return;
    }

    setIsSaving(true);
    try {
      // Generate clean unique ID
      const randomSuffix = Math.floor(100 + Math.random() * 900);
      const cleanSchoolId = `school_${Date.now().toString().slice(-4)}_${randomSuffix}`;

      // 1. Create Organization profile
      const newOrg: Organization = {
        id: cleanSchoolId,
        name: orgName.trim(),
        address: orgAddress.trim(),
        status: orgStatus,
      };

      const updatedOrgs = [...platData.organizations, newOrg];
      const updatedData: PlatformAdminData = {
        ...platData,
        organizations: updatedOrgs,
      };

      // 2. Initialize Organization structure document in /apps/{organizationId}
      const initialOrgData = getInitialAppDataForApi();
      initialOrgData.organizationSettings = {
        name: orgName.trim(),
        address: orgAddress.trim(),
        semester: "1",
        academicYear: new Date().getFullYear().toString(),
        operatingDays: initialOrgData.organizationSettings?.operatingDays || [],
      };
      
      const schoolDocRef = doc(db, 'apps', cleanSchoolId);
      await setDoc(schoolDocRef, initialOrgData);

      // 3. Save the central registry
      await savePlatDataToDb(updatedData);

      // Cleanup
      setOrgName('');
      setOrgAddress('');
      setOrgStatus('Active');
      setNotification({ type: 'success', message: `ลงทะเบียนโรงเรียนใหม่สำเร็จ! ID: ${cleanSchoolId}` });
      setTimeout(() => setNotification(null), 5000);
    } catch (err: any) {
      console.error("Register organization failed:", err);
      setNotification({ type: 'error', message: `ล้มเหลวในการจดทะเบียนสถาบัน: ${err.message || err}` });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete Organization
  const handleDeleteOrg = async (orgId: string) => {
    if (!window.confirm("ยืนยันที่จะลบสถาบันนี้ออกจากระบบส่วนกลาง? ข้อมูลตารางสอนภายในสถาบันจะไม่สามารถกู้คืนได้ และโดเมนทั้งหมดที่ผูกอยู่จะถูกลบออก")) {
      return;
    }

    const currentOrgs = platData?.organizations || [];
    const currentMappings = platData?.domainMappings || [];

    const updatedOrgs = currentOrgs.filter(org => org.id !== orgId);
    const updatedMappings = currentMappings.filter(m => m.organizationId !== orgId);

    const updatedData: PlatformAdminData = {
      organizations: updatedOrgs,
      domainMappings: updatedMappings,
    };

    if (impersonatedOrgId === orgId) {
      onExitImpersonation();
    }

    // Force UI state immediately
    setPlatData(updatedData);

    try {
       const { deleteDoc } = await import('firebase/firestore');
       await deleteDoc(doc(db, 'apps', orgId));
    } catch(err) {
       console.error("Failed to delete actual organization document:", err);
    }

    await savePlatDataToDb(updatedData);
  };

  // Toggle school status
  const handleToggleOrgStatus = async (orgId: string) => {
    const updatedOrgs = platData.organizations.map(org => {
      if (org.id === orgId) {
        return { ...org, status: org.status === 'Active' ? 'Suspended' : 'Active' } as Organization;
      }
      return org;
    });

    const updatedData: PlatformAdminData = {
      ...platData,
      organizations: updatedOrgs,
    };

    await savePlatDataToDb(updatedData);
  };

  // Add Domain mapping
  const handleAddDomainMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMappingOrgId) {
      setNotification({ type: 'error', message: 'กรุณาเลือกโรงเรียนเพื่อผูกโดเมน' });
      return;
    }

    let cleanDomain = mappingDomain.trim().toLowerCase();
    if (!cleanDomain) {
      setNotification({ type: 'error', message: 'กรุณากรอกโดเมนของโรงเรียน' });
      return;
    }

    // Ensure it starts with @ for standard checking
    if (!cleanDomain.startsWith('@')) {
      cleanDomain = '@' + cleanDomain;
    }

    const newMapping: DomainMapping = {
      domain: cleanDomain,
      organizationId: selectedMappingOrgId,
    };
    if (mappingAdminEmail.trim()) {
      newMapping.adminEmail = mappingAdminEmail.trim().toLowerCase();
    }

    let updatedMappings = [...platData.domainMappings];
    const existingIndex = updatedMappings.findIndex(m => m.domain === cleanDomain);

    if (existingIndex >= 0) {
      updatedMappings[existingIndex] = newMapping;
    } else {
      updatedMappings.push(newMapping);
    }

    const updatedData: PlatformAdminData = {
      ...platData,
      domainMappings: updatedMappings,
    };

    await savePlatDataToDb(updatedData, 'ระบบอัปเดตข้อมูลและล้างแคชเรียบร้อยแล้ว');

    // Also securely save inside the organization document
    if (newMapping.adminEmail) {
      try {
        const orgDocRef = doc(db, 'apps', newMapping.organizationId);
        const orgSnap = await getDoc(orgDocRef);
        if (orgSnap.exists()) {
           const orgData = orgSnap.data() as AppData;
           orgData.organizationSettings.schoolAdminEmail = newMapping.adminEmail;
           
           // Ensure the correct admin user exists and platform admin is removed
           const adminUser: User = {
             id: crypto.randomUUID(),
             name: 'School Admin',
             email: newMapping.adminEmail,
             role: 'admin',
             organizationId: newMapping.organizationId
           };
           
           const existingAdminIndex = orgData.users.findIndex(u => u.email.toLowerCase() === newMapping.adminEmail.toLowerCase());
           if (existingAdminIndex >= 0) {
               orgData.users[existingAdminIndex].role = 'admin';
           } else {
               orgData.users.push(adminUser);
           }

           await setDoc(orgDocRef, orgData);
        }
      } catch (err) {
        console.error("Failed to sync domain admin email to organization settings:", err);
      }
    }

    setMappingDomain('');
    setMappingAdminEmail('');
  };

  // Remove Domain mapping
  const handleRemoveDomainMapping = async (domain: string) => {
    if (!window.confirm(`ยืนยันการลบการผูกโดเมน ${domain}?`)) return;

    const currentMappings = platData?.domainMappings || [];
    const mappingToDelete = currentMappings.find(m => m.domain === domain);
    const updatedMappings = currentMappings.filter(m => m.domain !== domain);

    const updatedData: PlatformAdminData = {
      organizations: platData?.organizations || [],
      domainMappings: updatedMappings,
    };
    
    // Force update UI instantly
    setPlatData(updatedData);

    await savePlatDataToDb(updatedData, 'ระบบอัปเดตข้อมูลและล้างแคชเรียบร้อยแล้ว');

    // Attempt to remove from individual org document if it was an admin mapping
    if (mappingToDelete && mappingToDelete.adminEmail) {
      try {
        const orgDocRef = doc(db, 'apps', mappingToDelete.organizationId);
        const orgSnap = await getDoc(orgDocRef);
        if (orgSnap.exists()) {
           const orgData = orgSnap.data() as AppData;
           if (orgData.organizationSettings?.schoolAdminEmail === mappingToDelete.adminEmail) {
               orgData.organizationSettings.schoolAdminEmail = '';
           }
           if (orgData.users) {
               // Safely remove that specific user role
               orgData.users = orgData.users.filter(u => u.email.toLowerCase() !== mappingToDelete.adminEmail);
           }
           await setDoc(orgDocRef, orgData);
        }
      } catch (err) {
        console.error("Failed to sync domain mapping deletion to organization settings:", err);
      }
    }
  };

  const getSchoolNameById = (id: string) => {
    const org = (platData?.organizations || []).find(o => o.id === id);
    return org ? org.name : `สถาบันรหัส ${id}`;
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12" id="platform-admin-panel">
      {/* Impersonation Info Banner */}
      {impersonatedOrgId && (
        <div className="bg-amber-500 text-white font-medium p-4 rounded-lg flex justify-between items-center shadow" id="impersonation-ban">
          <div className="flex items-center space-x-2">
            <span className="text-xl">⚠️</span>
            <span>
              กำลังใช้งานระบบเลียนแบบสถาบัน: <strong>{getSchoolNameById(impersonatedOrgId)}</strong> ({impersonatedOrgId}) - [โหมดอ่านอย่างเดียว]
            </span>
          </div>
          <button
            onClick={onExitImpersonation}
            className="bg-white text-slate-800 hover:bg-slate-100 text-sm px-3 py-1.5 rounded font-semibold transition shadow-sm"
          >
            ยกเลิกสถาบันเลียนแบบ
          </button>
        </div>
      )}

      {/* Header and Summary */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b pb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center">
            <span className="mr-2">⚙️</span>
            ระบบควบคุมส่วนกลาง (Platform Admin Back-Office)
          </h1>
          <p className="text-sm text-slate-500">
            ระบบจัดสรรทรัพยากร ระบบโฮสติ้งแบ่งสัดส่วนการจัดตารางสอนและควบคุมการเข้าสู่ระบบผ่าน Google Domain สำหรับ Super Admin
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={loadPlatData}
            disabled={isLoading}
            className="p-2 border bg-white text-slate-600 rounded hover:bg-slate-50 transition shadow-sm disabled:opacity-50"
            title="รีโหลดข้อมูล"
          >
            🔄 รีโหลดข้อมูล
          </button>
        </div>
      </div>

      {/* Notification banner */}
      {notification && (
        <div
          className={`p-4 rounded-md shadow-sm border ${
            notification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
          id="plat-notif"
        >
          <p className="text-sm font-semibold">{notification.message}</p>
        </div>
      )}

      {/* Dashboard Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">โรงเรียนที่ลงทะเบียน</p>
            <p className="text-2xl font-bold text-slate-800">{platData.organizations.length} โรงเรียน</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">บุคลากรครูรวมทั้งแพลตฟอร์ม</p>
            <p className="text-2xl font-bold text-slate-800">{isLoading ? 'กำลังโหลด...' : `${totalTeachersCount} ท่าน`}</p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">สถานะการเชื่อมต่อฐานข้อมูล</p>
            <p className="text-lg font-bold text-emerald-600 flex items-center">
              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full inline-block mr-2 animate-ping"></span>
              {isDbOnline ? 'CONNECTED (FIRESTORE ONLINE)' : 'DISCONNECTED'}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('orgs')}
          className={`py-2 px-5 font-semibold text-sm transition-colors border-b-2 -mb-px ${
            activeTab === 'orgs'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          🏨 จัดการโรงเรียน/องค์กร (Organization Management)
        </button>
        <button
          onClick={() => setActiveTab('domains')}
          className={`py-2 px-5 font-semibold text-sm transition-colors border-b-2 -mb-px ${
            activeTab === 'domains'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          🔑 การควบคุมสิทธิ์และโดเมน (Domain & Authentication Management)
        </button>
      </div>

      {/* Subviews */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-500">กำลังดาวน์โหลดข้อมูลระบบส่วนกลาง...</div>
      ) : activeTab === 'orgs' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Add Org Form */}
          <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4 h-fit">
            <h2 className="text-lg font-bold text-slate-800 border-b pb-2">ลงทะเบียนหน่วยงานเพิ่มใหม่</h2>
            <form onSubmit={handleRegisterOrg} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">ชื่อโรงเรียน/สถาบัน *</label>
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="เช่น โรงเรียนอุตรดิตถ์"
                  className="w-full border rounded p-2 text-sm focus:ring focus:ring-blue-200 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">ที่อยู่/เบอร์ติดต่อติดต่อ</label>
                <textarea
                  value={orgAddress}
                  onChange={(e) => setOrgAddress(e.target.value)}
                  placeholder="เช่น ต.ท่าอิฐ อ.เมือง จ.อุตรดิตถ์"
                  rows={3}
                  className="w-full border rounded p-2 text-sm focus:ring focus:ring-blue-200 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">สถานะโครงการ</label>
                <select
                  value={orgStatus}
                  onChange={(e) => setOrgStatus(e.target.value as any)}
                  className="w-full border rounded p-2 text-sm focus:ring focus:ring-blue-200"
                >
                  <option value="Active">ใช้งานปกติ (Active)</option>
                  <option value="Suspended">ระงับชั่วคราว (Suspended)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded text-sm transition text-center shadow disabled:opacity-50"
              >
                {isSaving ? 'กำลังบันทึกข้อมูล...' : '➕ ลงทะเบียน & สร้างฐานข้อมูล'}
              </button>
            </form>
          </div>

          {/* Org Listings Table */}
          <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm lg:col-span-2 space-y-4">
            <h2 className="text-lg font-bold text-slate-800 border-b pb-2">โรงเรียนและฐานข้อมูลที่อยู่ในระบบ</h2>
            {platData.organizations.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">ไม่มีโรงเรียนลงทะเบียนในระบบ ทำการจดทะเบียนใหม่ด้านซ้ายมือ</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 text-xs uppercase font-bold border-b border-slate-200">
                      <th className="py-3 px-4">ตรา / ID</th>
                      <th className="py-3 px-4">ชื่อสถาบัน</th>
                      <th className="py-3 px-4">ที่อยู่</th>
                      <th className="py-3 px-4 text-center">สถานะ</th>
                      <th className="py-3 px-4 text-right">ดำเนินการสำหรับการสนับสนุน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platData.organizations.map((org) => (
                      <tr key={org.id} className="border-b border-slate-100 hover:bg-slate-50 text-sm">
                        <td className="py-3 px-4">
                          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-blue-800 font-bold">{org.id}</code>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800">{org.name}</td>
                        <td className="py-3 px-4 text-xs text-slate-500 max-w-[150px] truncate" title={org.address}>{org.address || '-'}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                              org.status === 'Active'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            {org.status === 'Active' ? 'พร้อมทำงาน' : 'ระงับบริการ'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                          {/* Impersonation action */}
                          <button
                            onClick={() => {
                              setImpersonatedOrgId(org.id);
                              onReloadMainData(org.id);
                              setNotification({ type: 'success', message: `ระบบทำงานเลียนแบบองค์กร ${org.name} สำเร็จ! [เปิดตารางสอนในโหมดอ่านอย่างเดียว]` });
                              setTimeout(() => setNotification(null), 5000);
                            }}
                            className={`px-2.5 py-1 text-xs font-medium rounded transition shadow-sm ${
                              impersonatedOrgId === org.id
                                ? 'bg-blue-600 text-white hover:bg-blue-700'
                                : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                            }`}
                          >
                            👁️ ทำงานแทน (Support)
                          </button>
                          <button
                            onClick={() => handleToggleOrgStatus(org.id)}
                            className="p-1 border hover:bg-slate-100 rounded text-slate-600"
                            title="สลับสถานะ"
                          >
                            🔄 {/* Toggle status */}
                          </button>
                          <button
                            onClick={() => handleDeleteOrg(org.id)}
                            className="p-1 border border-rose-200 text-rose-500 hover:bg-rose-50 rounded"
                            title="ลบสถาบันถาวร"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Domain Bind Form */}
          <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4 h-fit">
            <h2 className="text-lg font-bold text-slate-800 border-b pb-2">ผูก Google Email Domain เข้ากับสถาบัน</h2>
            <form onSubmit={handleAddDomainMapping} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">เลือกสถาบันการศึกษาปลายทาง *</label>
                <select
                  required
                  value={selectedMappingOrgId}
                  onChange={(e) => setSelectedMappingOrgId(e.target.value)}
                  className="w-full border rounded p-2 text-sm focus:ring focus:ring-blue-200"
                >
                  <option value="">-- เลือกโรงเรียน --</option>
                  {platData.organizations.map((org) => (
                    <option key={org.id} value={org.id}>{org.name} ({org.id})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">โดเมน (อาทิ เช่น @utd.ac.th, @satriutd.ac.th) *</label>
                <input
                  type="text"
                  required
                  value={mappingDomain}
                  onChange={(e) => setMappingDomain(e.target.value)}
                  placeholder="เช่น utd.ac.th"
                  className="w-full border rounded p-2 text-sm focus:ring focus:ring-blue-200 focus:border-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">ผู้ใช้ที่ล็อกอินด้วยอีเมล์ของโดเมนนี้ จะถูกจัดเก็บเข้าฐานข้อมูลตารางสอนของโรงเรียนนี้โดยอัตโนมัติ</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">อีเมลแอดมินโรงเรียน (Designated School Admin Email) *</label>
                <input
                  type="email"
                  required
                  value={mappingAdminEmail}
                  onChange={(e) => setMappingAdminEmail(e.target.value)}
                  placeholder="เช่น admin@school.ac.th"
                  className="w-full border rounded p-2 text-sm focus:ring focus:ring-blue-200 focus:border-blue-500"
                />
                <p className="text-xs text-slate-400 mt-1">ผู้ใช้ที่ล็อกอินด้วยอีเมลนี้จะได้รับสิทธิ์เป็นผู้ดูแลระบบของโรงเรียนนี้โดยอัตโนมัติ</p>
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded text-sm transition text-center shadow disabled:opacity-50"
              >
                {isSaving ? 'กำลังบันทึกข้อมูล...' : '🔗 เชื่อมโยงบัญชีโดเมน'}
              </button>
            </form>
          </div>

          {/* Domain Mapping Listings Table */}
          <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm lg:col-span-2 space-y-4">
            <h2 className="text-lg font-bold text-slate-800 border-b pb-2">รายการเชื่อมโยงโดเมนผู้ใช้งาน (Domain Routing Rule)</h2>
            {platData.domainMappings.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">ไม่มีการระบุความเชื่อมโยงโดเมน บัญชีโดเมนทั่วไปจะล็อกอินเข้าสู่ database "default"</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 text-xs uppercase font-bold border-b border-slate-200">
                      <th className="py-3 px-4">โดเมน (Allowed Email Domain)</th>
                      <th className="py-3 px-4">อีเมลผู้ดูแลโรงเรียน</th>
                      <th className="py-3 px-4">ชื่อโรงเรียนปลายทาง</th>
                      <th className="py-3 px-4">รหัสฐานข้อมูลโรงเรียน</th>
                      <th className="py-3 px-4 text-right">ดำเนินการลบออก</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platData.domainMappings.map((mapping, idx) => (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50 text-sm">
                        <td className="py-3 px-4 font-semibold text-blue-700">
                          <code>{mapping.domain}</code>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-slate-600">
                            {mapping.adminEmail || <span className="text-slate-400 italic">ไม่ระบุ</span>}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800">{getSchoolNameById(mapping.organizationId)}</td>
                        <td className="py-3 px-4 text-xs font-mono text-slate-500">{mapping.organizationId}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleRemoveDomainMapping(mapping.domain)}
                            className="p-1 text-red-500 hover:bg-rose-50 border border-transparent hover:border-rose-100 rounded"
                            title="ลบสิทธิ์โดเมน"
                          >
                            🗑️ ลบความสัมพันธ์
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
