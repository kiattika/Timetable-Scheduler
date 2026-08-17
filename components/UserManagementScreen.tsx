
import React, { useState, useEffect } from 'react';
import { User, UserRole, ScreenAccessProps } from '../types';
import Modal from './Modal';
import ConfirmationModal from './ConfirmationModal'; // Import ConfirmationModal
import { Icons } from '../constants';

interface UserManagementScreenProps extends ScreenAccessProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  currentUser: User | null | undefined; // Current "logged-in" user
  departments: string[];
}

const UserManagementScreen: React.FC<UserManagementScreenProps> = ({
  users,
  setUsers,
  permissions,
  currentUser,
  departments,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Partial<User>>({}); // Renamed for clarity
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);


  const IconComponent = Icons.Users; // Using the new UsersRound icon

  const roleOptions: { value: UserRole; label: string }[] = [
    { value: 'admin', label: 'ผู้ดูแลระบบ (Admin)' },
    { value: 'manager', label: 'ผู้จัดการ (Manager)' },
    { value: 'assistant', label: 'ผู้ช่วยจัดตารางสอน (Scheduler Assistant)' },
    { value: 'guest', label: 'แขก (Guest)' },
  ];

  const getRoleLabel = (roleValue: UserRole) => {
    return roleOptions.find(r => r.value === roleValue)?.label || roleValue;
  };

  const openModalForNew = () => {
    setEditingUser({ name: '', email: '', role: 'assistant' }); // Default role
    setEditingId(null);
    setError(null);
    setIsModalOpen(true);
  };

  const openModalForEdit = (user: User) => {
    setEditingUser({ ...user });
    setEditingId(user.id);
    setError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser({});
    setEditingId(null);
    setError(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditingUser(prev => ({ ...prev, [name]: value }));
    setError(null); // Clear error on input change
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!editingUser.name?.trim()) {
      setError('ชื่อผู้ใช้งาน (Name) ไม่สามารถเว้นว่างได้');
      return;
    }
    if (!editingUser.email?.trim()) {
      setError('อีเมล์ (Email) ไม่สามารถเว้นว่างได้');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editingUser.email)) {
        setError('รูปแบบอีเมล์ไม่ถูกต้อง');
        return;
    }
    if (!editingUser.role) {
      setError('กรุณาระบุบทบาท (Role)');
      return;
    }

    // Check for unique email (excluding self if editing)
    const emailExists = users.some(
      user => user.email.toLowerCase() === editingUser.email!.toLowerCase() && user.id !== editingId
    );
    if (emailExists) {
      setError('อีเมล์นี้ถูกใช้งานแล้ว กรุณาใช้อีเมล์อื่น');
      return;
    }

    // Prevent changing the role of the last admin to non-admin if it's the current user
    if (editingId && editingId === currentUser?.id && currentUser?.role === 'admin' && editingUser.role !== 'admin') {
        const adminCount = users.filter(u => u.role === 'admin').length;
        if (adminCount === 1) {
            setError('ไม่สามารถเปลี่ยนบทบาทของผู้ดูแลระบบคนสุดท้ายได้');
            return;
        }
    }


    if (editingId) {
      setUsers(prev =>
        prev.map(u => {
          if (u.id === editingId) {
            const updatedUser = { ...u, ...editingUser, id: editingId } as User;
            if (updatedUser.role !== 'assistant') {
              delete updatedUser.assignedDepartments;
            }
            return updatedUser;
          }
          return u;
        })
      );
    } else {
      const newUser: User = {
        id: crypto.randomUUID(),
        name: editingUser.name!,
        email: editingUser.email!,
        role: editingUser.role!,
        assignedDepartments: editingUser.role === 'assistant' ? editingUser.assignedDepartments : undefined,
      };
      setUsers(prev => [...prev, newUser]);
    }
    closeModal();
  };

  const requestDelete = (user: User) => {
    if (!permissions.canPerformAdminActions) {
        alert('เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบผู้ใช้งานได้');
        return;
    }
    
    const adminCount = users.filter(u => u.role === 'admin').length;
    if (user.role === 'admin' && adminCount <= 1) {
        alert('ไม่สามารถลบผู้ดูแลระบบคนสุดท้ายได้');
        return;
    }

    setUserToDelete(user);
    setIsConfirmDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (userToDelete) {
      setUsers(prevUsers => prevUsers.filter(user => user.id !== userToDelete.id));
    }
    setIsConfirmDeleteModalOpen(false);
    setUserToDelete(null);
  };
  
  const filteredUsers = users.filter(user => 
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    getRoleLabel(user.role).toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 bg-white shadow-lg rounded-lg">
      <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
        <div className="flex items-center">
          {IconComponent && <IconComponent size={32} className="mr-3 text-blue-600" />}
          <h2 className="text-2xl font-semibold text-slate-800">จัดการผู้ใช้งาน</h2>
        </div>
        <button
          onClick={openModalForNew}
          className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md shadow-md transition-colors duration-150"
          aria-label="เพิ่มผู้ใช้งานใหม่"
        >
          <Icons.Add size={20} className="mr-2" /> เพิ่มผู้ใช้งานใหม่
        </button>
      </div>

      <div className="mb-4 relative">
        <input
          type="text"
          placeholder="ค้นหาผู้ใช้งาน..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full p-2 pl-10 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          aria-label="ค้นหาผู้ใช้งาน"
        />
        <Icons.Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
      </div>

      {filteredUsers.length === 0 ? (
        <p className="text-slate-500 text-center py-8">
            {searchTerm ? 'ไม่พบผู้ใช้งานที่ตรงกับการค้นหา' : 'ยังไม่มีผู้ใช้งาน คลิก "เพิ่มผู้ใช้งานใหม่" เพื่อเริ่มต้น'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">ชื่อ (Name)</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">อีเมล์ (Email)</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">บทบาท (Role)</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">กลุ่มสาระฯ ที่รับผิดชอบ (Assigned Departments)</th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {filteredUsers.map(user => {
                const isLastAdmin = user.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1;
                const canDelete = permissions.canPerformAdminActions && !(user.id === currentUser?.id && isLastAdmin);
                
                let deleteTitle = "ลบผู้ใช้งาน";
                if (!permissions.canPerformAdminActions) deleteTitle = "การลบจำกัดเฉพาะผู้ดูแลระบบ";
                else if (isLastAdmin && user.role === 'admin') deleteTitle = "ไม่สามารถลบผู้ดูแลระบบคนสุดท้ายได้";


                return (
                    <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-slate-800">{user.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-600">{user.email}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        user.role === 'admin' ? 'bg-purple-100 text-purple-850' :
                        user.role === 'manager' ? 'bg-blue-100 text-blue-850' :
                        user.role === 'assistant' ? 'bg-green-100 text-green-850' :
                        'bg-slate-150 text-slate-700'
                      }`}>
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-600">
                      {user.role === 'assistant' ? (
                        user.assignedDepartments && user.assignedDepartments.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {user.assignedDepartments.map(d => (
                              <span key={d} className="bg-slate-100 border border-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-xs font-medium">
                                {d}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-amber-600 font-medium text-xs">⚠️ ยังไม่ได้กำหนดกลุ่มสาระฯ</span>
                        )
                      ) : (
                        <span className="text-slate-400 font-mono">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium space-x-2">
                        <button
                        onClick={() => openModalForEdit(user)}
                        className="text-blue-600 hover:text-blue-800 transition-colors"
                        title="แก้ไขผู้ใช้งาน"
                        aria-label={`แก้ไขผู้ใช้งาน ${user.name}`}
                        >
                        <Icons.Edit size={18} />
                        </button>
                        <button
                        onClick={() => requestDelete(user)}
                        className={`transition-colors ${canDelete ? 'text-red-600 hover:text-red-800' : 'text-slate-400 cursor-not-allowed'}`}
                        title={deleteTitle}
                        aria-label={`ลบผู้ใช้งาน ${user.name}`}
                        disabled={!canDelete}
                        >
                        <Icons.Delete size={18} />
                        </button>
                    </td>
                    </tr>
                );
            })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={`${editingId ? 'แก้ไข' : 'เพิ่ม'}ผู้ใช้งาน`}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200">{error}</p>}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
              ชื่อ (Name) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={editingUser.name || ''}
              onChange={handleInputChange}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              placeholder="เช่น John Doe"
              required
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              อีเมล์ (Email) <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={editingUser.email || ''}
              onChange={handleInputChange}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              placeholder="เช่น user@example.com"
              required
            />
          </div>
          <div>
            <label htmlFor="role" className="block text-sm font-medium text-slate-700 mb-1">
              บทบาท (Role) <span className="text-red-500">*</span>
            </label>
            <select
              id="role"
              name="role"
              value={editingUser.role || ''}
              onChange={handleInputChange}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              required
              disabled={editingId === currentUser?.id && currentUser?.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1 && editingUser.role !== 'admin'}
            >
              <option value="" disabled>เลือกบทบาท</option>
              {roleOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {editingId === currentUser?.id && currentUser?.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1 && editingUser.role !== 'admin' &&
                 <p className="text-xs text-amber-600 mt-1">ไม่สามารถเปลี่ยนบทบาทของตนเองเมื่อเป็นผู้ดูแลระบบคนสุดท้ายได้</p>
            }
          </div>
          
          {editingUser.role === 'assistant' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                กลุ่มสาระฯ ที่รับผิดชอบ (Assigned Departments)
              </label>
              {departments.length === 0 ? (
                <p className="text-sm text-slate-500 italic mb-2">ยังไม่มีข้อมูลกลุ่มสาระฯ ในระบบ (กรุณาเพิ่มในข้อมูลครูผู้สอนก่อน)</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-200 rounded p-3 bg-slate-50">
                  {departments.map(dept => (
                    <label key={dept} className="flex items-center space-x-2">
                      <input 
                        type="checkbox" 
                        className="rounded text-blue-600 focus:ring-blue-500"
                        checked={editingUser.assignedDepartments?.includes(dept) || false}
                        onChange={(e) => {
                          const isChecked = e.target.checked;
                          setEditingUser(prev => {
                            const prevDepts = prev.assignedDepartments || [];
                            return {
                              ...prev,
                              assignedDepartments: isChecked 
                                ? [...prevDepts, dept] 
                                : prevDepts.filter(d => d !== dept)
                            };
                          });
                        }}
                      />
                      <span className="text-sm text-slate-700">{dept}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
            >
              {editingId ? 'บันทึกการเปลี่ยนแปลง' : 'เพิ่มผู้ใช้งาน'}
            </button>
          </div>
        </form>
      </Modal>
      
      <ConfirmationModal
        isOpen={isConfirmDeleteModalOpen}
        onClose={() => {
            setIsConfirmDeleteModalOpen(false);
            setUserToDelete(null);
        }}
        onConfirm={confirmDelete}
        title="ยืนยันการลบผู้ใช้งาน"
        message={`คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้งาน '${userToDelete?.name || ''}' (${userToDelete?.email || ''})? การดำเนินการนี้ไม่สามารถย้อนกลับได้`}
        confirmButtonText="ลบผู้ใช้งาน"
        icon={Icons.Warning}
      />
    </div>
  );
};

export default UserManagementScreen;