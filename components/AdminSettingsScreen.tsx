import React, { useState } from 'react';
import { AppData, User } from '../types';
import { Icons } from '../constants';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { ORG_ID } from '../api';

interface AdminSettingsScreenProps {
  appData: AppData;
  setAppData: React.Dispatch<React.SetStateAction<AppData | null>>;
  setCurrentView?: (view: any) => void;
}

export const AdminSettingsScreen: React.FC<AdminSettingsScreenProps> = ({ appData, setAppData, setCurrentView }) => {
  const [newEmail, setNewEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const authorizedAdmins = (appData.authorizedAdmins || []).map(e => e.toLowerCase().trim());
  const currentUserEmail = (appData.currentUser?.email || '').toLowerCase().trim();
  
  const isAuthorizedAdmin = authorizedAdmins.includes(currentUserEmail) || appData.currentUser?.role === 'admin';

  if (!isAuthorizedAdmin) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-red-500 h-full font-bold gap-3">
        <Icons.ShieldAlert size={48} />
        <span className="text-xl">การเข้าถึงถูกปฏิเสธ (Access Denied)</span>
        <span className="text-sm font-normal text-slate-600">เฉพาะผู้ดูแลระบบที่มีสิทธิ์เท่านั้นที่สามารถเข้าถึงหน้านี้ได้</span>
      </div>
    );
  }

  const handleAddAdmin = async () => {
    if (!newEmail.trim()) return;
    const emailToAdd = newEmail.trim().toLowerCase();
    setErrorMessage(null);
    
    if (!emailToAdd.endsWith('@utd.ac.th')) {
        setErrorMessage("อนุญาตเฉพาะอีเมลโดเมน @utd.ac.th ของโรงเรียนอุตรดิตถ์เท่านั้น");
        return;
    }

    if (authorizedAdmins.includes(emailToAdd)) {
        setErrorMessage("อีเมลนี้อยู่ในรายชื่อผู้ดูแลระบบอยู่แล้ว");
        return;
    }

    try {
      setIsSubmitting(true);
      const setUserRoleFn = httpsCallable<
        { targetEmail: string; role: string; orgId: string },
        { success: boolean; message: string; users?: any[]; authorizedAdmins?: string[] }
      >(functions, 'setUserRole');

      const res = await setUserRoleFn({
        targetEmail: emailToAdd,
        role: 'admin',
        orgId: ORG_ID
      });

      // Update local state in sync
      setAppData(prev => {
        if (!prev) return null;
        const currentAdmins = (prev.authorizedAdmins || []).map(e => e.toLowerCase().trim());
        const updatedAdmins = currentAdmins.includes(emailToAdd) ? currentAdmins : [...currentAdmins, emailToAdd];
        
        const existingUsers = [...prev.users];
        const userIndex = existingUsers.findIndex(u => u.email.toLowerCase().trim() === emailToAdd);
        if (userIndex >= 0) {
          existingUsers[userIndex] = { ...existingUsers[userIndex], role: 'admin' };
        } else {
          existingUsers.push({
            id: crypto.randomUUID(),
            name: emailToAdd.split('@')[0],
            email: emailToAdd,
            role: 'admin',
            organizationId: ORG_ID
          });
        }

        return {
          ...prev,
          authorizedAdmins: updatedAdmins,
          users: existingUsers
        };
      });

      alert(`ตั้งค่าสิทธิ์ผู้ดูแลระบบเรียบร้อยแล้ว: ${emailToAdd}\n\n(หมายเหตุ: ผู้ใช้งานต้องออกจากระบบแล้วเข้าใหม่อีกครั้ง เพื่อให้ Firebase Token มีผลสมบูรณ์)`);
      setNewEmail('');
    } catch (err: any) {
      console.error("Error adding admin via Cloud Function:", err);
      const rawMsg = err?.message || '';
      if (rawMsg.includes('auth/user-not-found') || rawMsg.includes('not-found') || rawMsg.includes('ไม่พบบัญชีผู้ใช้')) {
        setErrorMessage(`ไม่พบบัญชีผู้ใช้ '${emailToAdd}' ในระบบ Firebase Auth กรุณาให้บุคคลนี้ล็อกอินเข้าสู่ระบบด้วย Google (@utd.ac.th) อย่างน้อย 1 ครั้งก่อนกำหนดสิทธิ์ผู้ดูแลระบบ`);
      } else if (rawMsg.includes('permission-denied') || rawMsg.includes('Only administrators')) {
        setErrorMessage('คุณไม่มีสิทธิ์ในการกำหนดบทบาทผู้ดูแลระบบ');
      } else {
        setErrorMessage(`เกิดข้อผิดพลาด: ${rawMsg || 'ไม่สามารถเพิ่มผู้ดูแลระบบได้'}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveAdmin = async (emailToRemove: string) => {
    const cleanEmail = emailToRemove.toLowerCase().trim();
    setErrorMessage(null);

    // Prevent removing the last admin
    if (authorizedAdmins.length <= 1) {
      alert("ไม่สามารถลบผู้ดูแลระบบคนสุดท้ายได้");
      return;
    }

    if (cleanEmail === currentUserEmail && authorizedAdmins.length <= 1) {
      alert("ไม่สามารถถอนสิทธิ์ผู้ดูแลระบบของตนเองได้เมื่อเป็นผู้ดูแลระบบคนเดียว");
      return;
    }

    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการถอนสิทธิ์ผู้ดูแลระบบของ '${cleanEmail}'? ผู้ใช้งานนี้จะถูกปรับเป็นสิทธิ์ 'ครูผู้สอน' (Teacher)`)) {
      return;
    }

    try {
      setIsSubmitting(true);
      const setUserRoleFn = httpsCallable<
        { targetEmail: string; role: string; orgId: string },
        { success: boolean; message: string; users?: any[]; authorizedAdmins?: string[] }
      >(functions, 'setUserRole');

      await setUserRoleFn({
        targetEmail: cleanEmail,
        role: 'teacher', // Safely downgrade to teacher
        orgId: ORG_ID
      });

      // Update local state in sync
      setAppData(prev => {
        if (!prev) return null;
        const updatedAdmins = (prev.authorizedAdmins || []).filter(e => e.toLowerCase().trim() !== cleanEmail);
        const existingUsers = prev.users.map(u => u.email.toLowerCase().trim() === cleanEmail ? { ...u, role: 'teacher' as const } : u);
        return {
          ...prev,
          authorizedAdmins: updatedAdmins,
          users: existingUsers
        };
      });

      alert(`ถอนสิทธิ์ผู้ดูแลระบบของ '${cleanEmail}' เรียบร้อยแล้ว (บทบาทถูกเปลี่ยนเป็นครูผู้สอน)`);
    } catch (err: any) {
      console.error("Error removing admin via Cloud Function:", err);
      setErrorMessage(`เกิดข้อผิดพลาดในการถอนสิทธิ์: ${err?.message || 'โปรดลองใหม่อีกครั้ง'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const allAdmins = Array.from(new Set(authorizedAdmins));

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center">
            <Icons.ShieldAlert className="mr-3 text-blue-600" size={28} />
            จัดการสิทธิ์ผู้ดูแลระบบ (Admin Permissions)
          </h2>
          <p className="text-slate-600 mt-1">กำหนดและจัดการสิทธิ์ผู้ดูแลระบบผ่าน Firebase Custom Claims แบบรวมศูนย์</p>
        </div>
        {setCurrentView && (
          <button
            onClick={() => setCurrentView('users')}
            className="flex items-center self-start md:self-auto bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2 px-4 rounded-md border border-slate-300 transition-colors shadow-sm text-sm"
          >
            <Icons.Users className="mr-2" size={16} />
            ไปที่หน้าจัดการผู้ใช้งานทั้งหมด
          </button>
        )}
      </div>

      {/* Information Banner */}
      <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-xl text-sm flex items-start gap-3">
        <Icons.Info size={20} className="text-blue-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold block mb-1">การจัดการสิทธิ์ผ่านระบบ Cloud Security (Firebase Custom Claims)</span>
          สิทธิ์ Admin ทั้งหมดถูกผูกกับระบบ Firebase Custom Claims โดยตรง การเพิ่มหรือถอนสิทธิ์ในหน้านี้หรือหน้า <span className="font-medium">จัดการผู้ใช้งาน</span> จะซิงค์ข้อมูลทั้ง Custom Claims และฐานข้อมูลโดยอัตโนมัติ (ผู้ใช้งานที่ได้รับหรือถูกถอนสิทธิ์ต้องทำการ Sign Out และ Sign In ใหม่อีกครั้งเพื่อให้สิทธิ์ในระบบมีผลสมบูรณ์)
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm flex items-start gap-3">
          <Icons.Warning size={20} className="text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">ข้อผิดพลาด:</span> {errorMessage}
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-red-500 hover:text-red-700 text-xs">
            ปิด
          </button>
        </div>
      )}

      {/* Add New Admin */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-800 mb-2">เพิ่มผู้ดูแลระบบใหม่ (Add New Admin)</h3>
        <p className="text-xs text-slate-500 mb-4">
          บุคคลที่ต้องการเพิ่มจะต้องเคยล็อกอินเข้าสู่ระบบด้วย Google (@utd.ac.th) อย่างน้อย 1 ครั้ง เพื่อให้มีบัญชีในระบบ Firebase Auth
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
            <input
                type="email"
                value={newEmail}
                onChange={(e) => {
                  setNewEmail(e.target.value);
                  setErrorMessage(null);
                }}
                placeholder="ระบุอีเมลครูผู้สอน เช่น teacher@utd.ac.th"
                className="flex-1 rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 px-4 py-2 border text-sm"
                disabled={isSubmitting}
            />
            <button
                onClick={handleAddAdmin}
                disabled={isSubmitting || !newEmail.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-md font-medium shadow-sm transition-colors flex items-center justify-center text-sm"
            >
                {isSubmitting ? (
                  <>
                    <Icons.Loading size={16} className="animate-spin mr-2" />
                    กำลังบันทึก...
                  </>
                ) : (
                  'เพิ่มผู้ดูแลระบบ'
                )}
            </button>
        </div>
      </div>

      {/* Admins Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 text-sm">รายชื่อผู้ดูแลระบบปัจจุบัน ({allAdmins.length} ท่าน)</h3>
        </div>
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">อีเมล / บัญชีผู้ใช้</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">สถานะสิทธิ์</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">การจัดการ</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {allAdmins.map((email) => {
                const userObj = appData.users.find(u => u.email.toLowerCase().trim() === email);
                const isSelf = email === currentUserEmail;

                return (
                    <tr key={email} className="hover:bg-slate-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                          <div>
                            <span>{email}</span>
                            {userObj?.name && (
                              <span className="block text-xs text-slate-500 font-normal">{userObj.name}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                <Icons.Check size={12} className="mr-1 text-blue-600" /> Authorized Admin
                            </span>
                            {isSelf && (
                              <span className="ml-2 text-xs text-slate-400 font-normal">(บัญชีของคุณ)</span>
                            )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                                onClick={() => handleRemoveAdmin(email)}
                                disabled={isSubmitting || (isSelf && allAdmins.length <= 1)}
                                className="text-red-600 hover:text-red-900 disabled:opacity-40 transition-colors text-sm"
                                title={isSelf && allAdmins.length <= 1 ? 'ไม่สามารถถอนสิทธิ์ตนเองได้เมื่อเป็นแอดมินคนเดียว' : 'ถอนสิทธิ์ผู้ดูแลระบบ'}
                            >
                                ถอนสิทธิ์
                            </button>
                        </td>
                    </tr>
                );
            })}
            {allAdmins.length === 0 && (
                <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-slate-500">
                        ไม่พบรายชื่อผู้ดูแลระบบในระบบ
                    </td>
                </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* DO NOT MODIFY OR REMOVE: Auto-Assign Orphaned Teachers/Subjects tool */}
      {isAuthorizedAdmin && (
      <div className="mt-8 bg-white p-6 rounded-lg shadow-sm border border-slate-200">
        <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center">
            <Icons.Settings className="w-5 h-5 mr-2" /> เครื่องมือซ่อมแซมข้อมูลครู/วิชา (สำหรับผู้ดูแลระบบ)
        </h2>
        <div className="flex space-x-4">
            <button 
                onClick={() => {
                   if (confirm('This will assign all teachers and subjects missing a department to the first available department in Master Data. Proceed?')) {
                       setAppData(prev => {
                           if (!prev) return null;
                           const firstDept = prev.departments && prev.departments.length > 0 ? prev.departments[0].name : 'Default';
                           const newTeachers = prev.teachers.map(t => t.department ? t : { ...t, department: firstDept });
                           const newSubjects = prev.subjects.map(s => s.department ? s : { ...s, department: firstDept });
                           return { ...prev, teachers: newTeachers, subjects: newSubjects };
                       });
                       alert('Data re-assigned successfully!');
                   }
                }}
                className="bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 px-4 rounded-md transition-colors"
            >
                จัดกลุ่มสาระให้ครู/วิชาที่ยังไม่มีกลุ่มสาระอัตโนมัติ
            </button>
        </div>
      </div>
      )}
    </div>
  );
};
