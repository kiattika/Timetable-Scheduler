import React, { useState } from 'react';
import { AppData, User } from '../types';
import { Icons } from '../constants';

interface AdminSettingsScreenProps {
  appData: AppData;
  setAppData: React.Dispatch<React.SetStateAction<AppData | null>>;
}

export const AdminSettingsScreen: React.FC<AdminSettingsScreenProps> = ({ appData, setAppData }) => {
  const [newEmail, setNewEmail] = useState('');
  const authorizedAdmins = appData.authorizedAdmins || [];
  const currentUserEmail = appData.currentUser?.email || '';
  
  const isAuthorizedAdmin = authorizedAdmins.includes(currentUserEmail);

  if (!isAuthorizedAdmin) {
    return <div className="p-8 flex items-center justify-center text-red-500 h-full font-bold">Access Denied</div>;
  }

  const handleAddAdmin = () => {
    if (!newEmail.trim()) return;
    const emailToAdd = newEmail.trim().toLowerCase();
    
    if (!emailToAdd.endsWith('@utd.ac.th')) {
        alert("อนุญาตเฉพาะอีเมลโดเมน @utd.ac.th ของโรงเรียนอุตรดิตถ์เท่านั้น");
        return;
    }

    if (authorizedAdmins.includes(emailToAdd)) {
        alert("This email is already in the authorized admins list.");
        return;
    }

    setAppData(prev => {
        if (!prev) return null;
        return {
            ...prev,
            authorizedAdmins: [...(prev.authorizedAdmins || []), emailToAdd]
        };
    });
    setNewEmail('');
  };

  const handleRemoveAdmin = (emailToRemove: string) => {
    setAppData(prev => {
        if (!prev) return null;
        return {
            ...prev,
            authorizedAdmins: (prev.authorizedAdmins || []).filter(e => e !== emailToRemove)
        };
    });
  };

  const allAdmins = [...authorizedAdmins];

  return (
    <div className="p-6 md:p-8 max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 flex items-center">
          <Icons.Users className="mr-3 text-blue-600" size={28} />
          Dynamic Admin Permissions
        </h2>
        <p className="text-slate-600 mt-2">จัดการสิทธิ์ผู้ดูแลระบบ (Admin) สำหรับการจัดการข้อมูลและตั้งค่าระบบ</p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Add New Admin</h3>
        <div className="flex gap-4">
            <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Enter teacher's email address..."
                className="flex-1 rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 px-4 py-2 border"
            />
            <button
                onClick={handleAddAdmin}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-medium shadow-sm transition-colors"
            >
                Add Admin
            </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Email Address</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Role Type</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {allAdmins.map((email) => {
                return (
                    <tr key={email} className="hover:bg-slate-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{email}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                Authorized Admin
                            </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                                onClick={() => handleRemoveAdmin(email)}
                                className="text-red-600 hover:text-red-900 transition-colors"
                            >
                                Remove
                            </button>
                        </td>
                    </tr>
                );
            })}
            {allAdmins.length === 0 && (
                <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-slate-500">
                        No admins found.
                    </td>
                </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAuthorizedAdmin && (
      <div className="mt-8 bg-white p-6 rounded-lg shadow-sm border border-slate-200">
        <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center">
            <Icons.Settings className="w-5 h-5 mr-2" /> Data Maintenance (Authorized Admin)
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
                Auto-Assign Orphaned Teachers/Subjects to 1st Department
            </button>
        </div>
      </div>
      )}
    </div>
  );
};

