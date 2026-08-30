
import React, { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import { OrganizationSettings, ScreenAccessProps, DayOfWeek, User } from '../types';
import { Icons } from '../constants';
import { fetchAppData, resetSemesterTimetable, ORG_ID } from '../api';
import { buildTimetableBackupPayload, triggerJsonDownload } from '../utils/backup';
import { generateOfficialMemoPdf, generateSchoolOrderPdf } from '../utils/officialDocumentsPdf';
import { generateOfficialMemoDocx, generateSchoolOrderDocx } from '../utils/officialDocumentsDocx';

interface OrganizationSettingsScreenProps extends ScreenAccessProps {
  organizationSettings: OrganizationSettings | null;
  setOrganizationSettings: (settings: OrganizationSettings | null) => void;
  currentUser?: User | null;
}

const OrganizationSettingsScreen: React.FC<OrganizationSettingsScreenProps> = ({
  organizationSettings,
  setOrganizationSettings,
  permissions,
  currentUser,
}) => {
  const [currentSettings, setCurrentSettings] = useState<Partial<OrganizationSettings>>({});
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [emblemPreview, setEmblemPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isConfirmClearModalOpen, setIsConfirmClearModalOpen] = useState(false);
  const [hasDownloadedBackupForClear, setHasDownloadedBackupForClear] = useState(false);
  const [isDownloadingBackupForClear, setIsDownloadingBackupForClear] = useState(false);
  const [isResetSemesterModalOpen, setIsResetSemesterModalOpen] = useState(false);
  const [hasDownloadedBackup, setHasDownloadedBackup] = useState(false);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [fetchedDomain, setFetchedDomain] = useState<string>('');

  useEffect(() => {
    if (organizationSettings) {
      const defaultSettings: Partial<OrganizationSettings> = {
        name: '',
        semester: '',
        academicYear: '',
        directorName: '',
        directorPosition: 'ผู้อำนวยการ',
        deputyDirectorName: '',
        deputyDirectorPosition: 'รองผู้อำนวยการ',
        semesterStartDate: '',
        semesterEndDate: '',
        schoolHolidays: '',
        operatingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as DayOfWeek[],
        allowedDomain: '',
        schoolAdminEmail: '',
        orderNumber: '',
        orderDate: '',
        department: 'กลุ่มบริหารวิชาการ',
        workGroupName: 'กลุ่มงานวิชาการและหลักสูตร',
        proposerName: '',
        proposerPosition: 'หัวหน้างานจัดตารางสอน',
        reviewerName: '',
        reviewerPosition: 'หัวหน้ากลุ่มงานวิชาการและหลักสูตร',
        legalBasisText: '',
      };
      setCurrentSettings({ ...defaultSettings, ...organizationSettings });
      setLogoPreview(organizationSettings.logoUrl || null);
      setEmblemPreview(organizationSettings.emblemUrl || null);
    }
  }, [organizationSettings]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setCurrentSettings(prev => ({ ...prev, [name]: value }));
    setSuccessMessage(null); // Clear success message on input change
    setError(null);
  };

  const handleLogoChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSuccessMessage(null);
    setError(null);
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { // 2MB limit
        setError("ไฟล์โลโก้ต้องมีขนาดไม่เกิน 2MB");
        setLogoPreview(currentSettings.logoUrl || null); // Revert to old preview or null
        e.target.value = ""; // Clear the file input
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
        setCurrentSettings(prev => ({ ...prev, logoUrl: reader.result as string }));
      };
      reader.onerror = () => {
        setError("เกิดข้อผิดพลาดในการอ่านไฟล์โลโก้");
        setLogoPreview(currentSettings.logoUrl || null);
      }
      reader.readAsDataURL(file);
    } else {
        setLogoPreview(organizationSettings?.logoUrl || null);
        setCurrentSettings(prev => ({...prev, logoUrl: organizationSettings?.logoUrl || undefined}));
    }
  };
  
  const removeLogo = () => {
    setLogoPreview(null);
    setCurrentSettings(prev => ({ ...prev, logoUrl: undefined }));
    setSuccessMessage(null);
    setError(null);
    const fileInput = document.getElementById('logoUrl') as HTMLInputElement;
    if (fileInput) {
        fileInput.value = "";
    }
  };

  const handleEmblemChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSuccessMessage(null);
    setError(null);
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { // 2MB limit
        setError("ไฟล์รูปครุฑต้องมีขนาดไม่เกิน 2MB");
        setEmblemPreview(currentSettings.emblemUrl || null);
        e.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setEmblemPreview(reader.result as string);
        setCurrentSettings(prev => ({ ...prev, emblemUrl: reader.result as string }));
      };
      reader.onerror = () => {
        setError("เกิดข้อผิดพลาดในการอ่านไฟล์รูปครุฑ");
        setEmblemPreview(currentSettings.emblemUrl || null);
      };
      reader.readAsDataURL(file);
    } else {
      setEmblemPreview(organizationSettings?.emblemUrl || null);
      setCurrentSettings(prev => ({ ...prev, emblemUrl: organizationSettings?.emblemUrl || undefined }));
    }
  };

  const removeEmblem = () => {
    setEmblemPreview(null);
    setCurrentSettings(prev => ({ ...prev, emblemUrl: undefined }));
    setSuccessMessage(null);
    setError(null);
    const fileInput = document.getElementById('emblemUrl') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = "";
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!currentSettings.name?.trim()) {
      setError('ชื่อหน่วยงานไม่สามารถเว้นว่างได้');
      return;
    }
     if (!currentSettings.semester?.trim()) {
      setError('ภาคเรียนไม่สามารถเว้นว่างได้');
      return;
    }
    if (!currentSettings.academicYear?.trim()) {
      setError('ปีการศึกษาไม่สามารถเว้นว่างได้');
      return;
    }
    if (currentSettings.academicYear && !/^\d{4}$/.test(currentSettings.academicYear)) {
        setError('ปีการศึกษาต้องเป็นตัวเลข 4 หลัก');
        return;
    }

    // Basic email validation
    if (currentSettings.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentSettings.email)) {
        setError('รูปแบบอีเมล์ไม่ถูกต้อง');
        return;
    }

    if (currentSettings.schoolAdminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentSettings.schoolAdminEmail)) {
        setError('รูปแบบอีเมล์แอดมินไม่ถูกต้อง');
        return;
    }

    setOrganizationSettings(currentSettings as OrganizationSettings);
    setSuccessMessage('บันทึกข้อมูลหน่วยงานสำเร็จแล้ว');
  };

  const requestClearAll = () => {
    if (!permissions.canPerformManagerActions) {
        alert('เฉพาะผู้จัดการเท่านั้นที่สามารถลบข้อมูลหน่วยงานได้');
        return;
    }
    setHasDownloadedBackupForClear(false);
    setIsConfirmClearModalOpen(true);
  };

  const handleCloseClearModal = () => {
    setIsConfirmClearModalOpen(false);
    setHasDownloadedBackupForClear(false);
  };

  const handleDownloadBackupForClear = async () => {
    try {
      setIsDownloadingBackupForClear(true);
      const orgId = ORG_ID;
      const appData = await fetchAppData(orgId);
      const { backupData, filename } = buildTimetableBackupPayload(appData);
      triggerJsonDownload(backupData, filename);
      setHasDownloadedBackupForClear(true);
      alert("บันทึกข้อมูลสำรองเรียบร้อยแล้ว\nไฟล์ถูกบันทึกไว้ในโฟลเดอร์ดาวน์โหลดของเบราว์เซอร์ (Downloads)");
    } catch (err) {
      console.error("Failed to download backup", err);
      alert("เกิดข้อผิดพลาดในการดาวน์โหลดข้อมูลสำรอง");
    } finally {
      setIsDownloadingBackupForClear(false);
    }
  };

  const confirmClearAll = () => {
    if (!hasDownloadedBackupForClear) {
      alert("กรุณาดาวน์โหลดข้อมูลสำรองก่อนทำรายการ");
      return;
    }
    setOrganizationSettings(null); // This will trigger useEffect to set default fields
    setError(null);
    setSuccessMessage('ลบข้อมูลหน่วยงานทั้งหมดแล้ว และได้ตั้งค่าเริ่มต้นให้บางส่วน');
    setIsConfirmClearModalOpen(false);
    setHasDownloadedBackupForClear(false);
  };

  const requestResetSemester = () => {
    if (currentUser?.role !== 'admin') return;
    setHasDownloadedBackup(false);
    setIsResetSemesterModalOpen(true);
  };

  const handleDownloadBackup = async () => {
    try {
      setIsDownloadingBackup(true);
      const orgId = ORG_ID;
      const appData = await fetchAppData(orgId);
      const { backupData, filename } = buildTimetableBackupPayload(appData);
      triggerJsonDownload(backupData, filename);
      setHasDownloadedBackup(true);
      alert("บันทึกข้อมูลสำรองเรียบร้อยแล้ว\nไฟล์ถูกบันทึกไว้ในโฟลเดอร์ดาวน์โหลดของเบราว์เซอร์ (Downloads)");
    } catch (err) {
      console.error("Failed to download backup", err);
      alert("เกิดข้อผิดพลาดในการดาวน์โหลดข้อมูลสำรอง");
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  const confirmResetSemester = async () => {
    if (!hasDownloadedBackup) {
      alert("กรุณาดาวน์โหลดข้อมูลสำรองก่อนทำรายการ");
      return;
    }
    try {
      setIsResetting(true);
      const orgId = ORG_ID;
      await resetSemesterTimetable(orgId, currentUser);
      setIsResetSemesterModalOpen(false);
      alert("รีเซ็ตตารางเรียนสำหรับภาคเรียนใหม่เรียบร้อยแล้ว");
    } catch (err) {
      console.error("Failed to reset semester", err);
      alert("เกิดข้อผิดพลาดในการรีเซ็ตตารางเรียน");
    } finally {
      setIsResetting(false);
    }
  };

  const IconComponent = Icons.Landmark;

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="p-4 md:p-6 bg-white shadow-lg rounded-lg max-w-2xl mx-auto">
      <div className="flex items-center mb-6">
        {IconComponent && <IconComponent size={32} className="mr-3 text-blue-600" />}
        <h2 className="text-2xl font-semibold text-slate-800">ข้อมูลหน่วยงาน</h2>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200">{error}</p>}
      {successMessage && <p className="mb-4 text-sm text-green-600 bg-green-50 p-3 rounded-md border border-green-200">{successMessage}</p>}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Core System Configuration Section */}
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <Icons.TeacherSchedules size={18} className="text-blue-600" />
              การตั้งค่าหลักของหน่วยงาน (Core System Configuration)
            </h3>
          </div>
          
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
              ชื่อหน่วยงาน (School Name) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={currentSettings.name || ''}
              onChange={handleInputChange}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              placeholder="เช่น โรงเรียนอุตรดิตถ์"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="allowedDomain" className="block text-sm font-medium text-slate-700 mb-1">
                โดเมนที่อนุญาต (Allowed Domain)
              </label>
              <input
                type="text"
                id="allowedDomain"
                name="allowedDomain"
                value={fetchedDomain || ''}
                readOnly
                disabled
                className="w-full p-2 border rounded-md shadow-sm transition-colors bg-slate-100 cursor-not-allowed border-slate-200 text-slate-500"
                placeholder="เช่น @utd.ac.th"
              />
            </div>
            <div>
              <label htmlFor="schoolAdminEmail" className="block text-sm font-medium text-slate-700 mb-1">
                อีเมลแอดมินโรงเรียน (School Admin Email)
              </label>
              <input
                type="email"
                id="schoolAdminEmail"
                name="schoolAdminEmail"
                value={currentSettings.schoolAdminEmail || ''}
                onChange={handleInputChange}
                className="w-full p-2 border border-slate-300 rounded-md shadow-sm transition-colors focus:ring-blue-500 focus:border-blue-500"
                placeholder="เช่น admin@utd.ac.th"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
                <label htmlFor="semester" className="block text-sm font-medium text-slate-700 mb-1">
                    ภาคเรียน <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    id="semester"
                    name="semester"
                    value={currentSettings.semester || ''}
                    onChange={handleInputChange}
                    className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                    placeholder="เช่น 1, 2, Summer"
                    required
                />
            </div>
            <div>
                <label htmlFor="academicYear" className="block text-sm font-medium text-slate-700 mb-1">
                    ปีการศึกษา <span className="text-red-500">*</span>
                </label>
                <input
                    type="text"
                    id="academicYear"
                    name="academicYear"
                    value={currentSettings.academicYear || ''}
                    onChange={handleInputChange}
                    className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                    placeholder="เช่น 2567"
                    required
                />
            </div>
        </div>

        {/* Term Lock Option (Admin only) */}
        <div className="border border-slate-200 p-4 rounded-md bg-slate-50 flex items-center justify-between">
            <div className="mr-4 text-left">
                <h4 className="text-sm font-semibold text-slate-800">ล็อคตารางเรียนประจำภาคเรียน (Lock Semester Timetable)</h4>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    เมื่อเปิดใช้งาน ตารางเรียนทั้งหมดสำหรับภาคเรียนนี้จะถูกตั้งค่านำเสนอเป็นแบบ "อ่านอย่างเดียว (Read-Only)" และระงับการทำงานปรับแต่ง/โยกย้ายข้อมูลทุกตำแหน่งชั่วคราว
                </p>
                {!isAdmin && (
                    <div className="text-[11px] text-amber-600 font-semibold mt-1.5 flex items-center gap-1 bg-amber-50 px-2 py-1 rounded border border-amber-200 inline-block">
                        ⚠️ เฉพาะ Admin เท่านั้นที่มีสิทธิ์เปิด-ปิดระบบล็อกตาราง
                    </div>
                )}
            </div>
            <label className={`relative inline-flex items-center flex-shrink-0 select-none ${!isAdmin ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                <input 
                    type="checkbox" 
                    checked={currentSettings.isLocked || false}
                    onChange={(e) => {
                        if (!isAdmin) {
                            alert("เฉพาะ Admin เท่านั้นที่มีสิทธิ์เปิด-ปิดระบบล็อกตาราง");
                            return;
                        }
                        setCurrentSettings(prev => ({ ...prev, isLocked: e.target.checked }));
                    }}
                    disabled={!isAdmin}
                    className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="logoUrl" className="block text-sm font-medium text-slate-700 mb-1">
              ตราประจำหน่วยงาน (Logo)
            </label>
            <input
              type="file"
              id="logoUrl"
              name="logoUrl"
              accept="image/png, image/jpeg, image/gif, image/svg+xml"
              onChange={handleLogoChange}
              className="w-full text-sm text-slate-500
                         file:mr-4 file:py-2 file:px-4
                         file:rounded-md file:border-0
                         file:text-sm file:font-semibold
                         file:bg-blue-50 file:text-blue-700
                         hover:file:bg-blue-100"
            />
            {logoPreview && (
              <div className="mt-3 relative inline-block">
                <img src={logoPreview} alt="Logo Preview" className="h-24 w-auto max-w-xs border border-slate-300 rounded-md shadow-sm" />
                <button 
                  type="button" 
                  onClick={removeLogo} 
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 shadow-md"
                  aria-label="Remove logo"
                  title="ลบโลโก้"
                  >
                  <Icons.Close size={14} />
                </button>
              </div>
            )}
            <p className="text-xs text-slate-500 mt-1">สำหรับหัวตาราง/หน้ารายงาน (PNG, JPG, SVG ไม่เกิน 2MB)</p>
          </div>

          <div>
            <label htmlFor="emblemUrl" className="block text-sm font-medium text-slate-700 mb-1">
              รูปครุฑ (ตราครุฑสำหรับเอกสารราชการ)
            </label>
            <input
              type="file"
              id="emblemUrl"
              name="emblemUrl"
              accept="image/png, image/jpeg, image/gif, image/svg+xml"
              onChange={handleEmblemChange}
              className="w-full text-sm text-slate-500
                         file:mr-4 file:py-2 file:px-4
                         file:rounded-md file:border-0
                         file:text-sm file:font-semibold
                         file:bg-indigo-50 file:text-indigo-700
                         hover:file:bg-indigo-100"
            />
            {emblemPreview && (
              <div className="mt-3 relative inline-block">
                <img src={emblemPreview} alt="Garuda Emblem Preview" className="h-24 w-auto max-w-xs border border-slate-300 rounded-md shadow-sm" />
                <button 
                  type="button" 
                  onClick={removeEmblem} 
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 shadow-md"
                  aria-label="Remove emblem"
                  title="ลบรูปครุฑ"
                  >
                  <Icons.Close size={14} />
                </button>
              </div>
            )}
            <p className="text-xs text-slate-500 mt-1">สำหรับบันทึกข้อความและคำสั่งราชการ (PNG, JPG, SVG ไม่เกิน 2MB)</p>
          </div>
        </div>

        <div>
          <label htmlFor="address" className="block text-sm font-medium text-slate-700 mb-1">
            ที่อยู่
          </label>
          <textarea
            id="address"
            name="address"
            value={currentSettings.address || ''}
            onChange={handleInputChange}
            rows={3}
            className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
            placeholder="เช่น 123 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110"
          />
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                    อีเมล์
                </label>
                <input
                    type="email"
                    id="email"
                    name="email"
                    value={currentSettings.email || ''}
                    onChange={handleInputChange}
                    className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                    placeholder="เช่น contact@example.ac.th"
                />
            </div>
            <div>
                <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
                    เบอร์โทรศัพท์
                </label>
                <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={currentSettings.phone || ''}
                    onChange={handleInputChange}
                    className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                    placeholder="เช่น 02-123-4567"
                />
            </div>
        </div>

        {/* --- ข้อมูลสำหรับเอกสารราชการและคำสั่ง --- */}
        <fieldset className="border border-slate-200 p-6 rounded-xl bg-slate-50/50 space-y-4">
            <legend className="text-lg font-semibold text-slate-800 px-3 flex items-center bg-white rounded-md border border-slate-200 shadow-sm py-1">
                <Icons.FileText size={20} className="mr-2 text-blue-600" /> ข้อมูลสำหรับเอกสารราชการและคำสั่ง
            </legend>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                    <label htmlFor="orderNumber" className="block text-sm font-medium text-slate-700 mb-1">
                        เลขที่คำสั่ง
                    </label>
                    <input
                        type="text"
                        id="orderNumber"
                        name="orderNumber"
                        value={currentSettings.orderNumber || ''}
                        onChange={handleInputChange}
                        className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                        placeholder="เช่น 371/2569"
                    />
                </div>
                <div>
                    <label htmlFor="orderDate" className="block text-sm font-medium text-slate-700 mb-1">
                        วันที่ออกคำสั่ง/บันทึกข้อความ
                    </label>
                    <input
                        type="date"
                        id="orderDate"
                        name="orderDate"
                        value={currentSettings.orderDate || ''}
                        onChange={handleInputChange}
                        className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                    />
                </div>
                <div>
                    <label htmlFor="department" className="block text-sm font-medium text-slate-700 mb-1">
                        กลุ่มบริหาร
                    </label>
                    <input
                        type="text"
                        id="department"
                        name="department"
                        value={currentSettings.department || ''}
                        onChange={handleInputChange}
                        className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                        placeholder="เช่น กลุ่มบริหารวิชาการ"
                    />
                </div>
                <div>
                    <label htmlFor="workGroupName" className="block text-sm font-medium text-slate-700 mb-1">
                        ชื่อกลุ่มงาน
                    </label>
                    <input
                        type="text"
                        id="workGroupName"
                        name="workGroupName"
                        value={currentSettings.workGroupName || ''}
                        onChange={handleInputChange}
                        className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                        placeholder="เช่น กลุ่มงานวิชาการและหลักสูตร"
                    />
                </div>
            </div>

            {/* ผู้เสนอ (ผู้จัดทำ) */}
            <div className="p-3 bg-white rounded-lg border border-slate-200">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">กลุ่มผู้เสนอ (ผู้จัดทำ)</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label htmlFor="proposerName" className="block text-xs font-medium text-slate-700 mb-1">
                            ชื่อผู้เสนอ
                        </label>
                        <input
                            type="text"
                            id="proposerName"
                            name="proposerName"
                            value={currentSettings.proposerName || ''}
                            onChange={handleInputChange}
                            className="w-full p-2 text-sm border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                            placeholder="เช่น นายวิชาญ สอนดี"
                        />
                    </div>
                    <div>
                        <label htmlFor="proposerPosition" className="block text-xs font-medium text-slate-700 mb-1">
                            ตำแหน่งผู้เสนอ
                        </label>
                        <input
                            type="text"
                            id="proposerPosition"
                            name="proposerPosition"
                            value={currentSettings.proposerPosition || ''}
                            onChange={handleInputChange}
                            className="w-full p-2 text-sm border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                            placeholder="เช่น หัวหน้างานจัดตารางสอน"
                        />
                    </div>
                </div>
            </div>

            {/* ผู้ตรวจสอบ */}
            <div className="p-3 bg-white rounded-lg border border-slate-200">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">กลุ่มผู้ตรวจสอบ</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label htmlFor="reviewerName" className="block text-xs font-medium text-slate-700 mb-1">
                            ชื่อผู้ตรวจสอบ
                        </label>
                        <input
                            type="text"
                            id="reviewerName"
                            name="reviewerName"
                            value={currentSettings.reviewerName || ''}
                            onChange={handleInputChange}
                            className="w-full p-2 text-sm border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                            placeholder="เช่น นางปราณี รักการสอน"
                        />
                    </div>
                    <div>
                        <label htmlFor="reviewerPosition" className="block text-xs font-medium text-slate-700 mb-1">
                            ตำแหน่งผู้ตรวจสอบ
                        </label>
                        <input
                            type="text"
                            id="reviewerPosition"
                            name="reviewerPosition"
                            value={currentSettings.reviewerPosition || ''}
                            onChange={handleInputChange}
                            className="w-full p-2 text-sm border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                            placeholder="เช่น หัวหน้ากลุ่มงานวิชาการและหลักสูตร"
                        />
                    </div>
                </div>
            </div>

            {/* อำนาจตามกฎหมาย */}
            <div>
                <label htmlFor="legalBasisText" className="block text-sm font-medium text-slate-700 mb-1">
                    อำนาจตามกฎหมาย (สาระสำคัญในคำสั่ง)
                </label>
                <textarea
                    id="legalBasisText"
                    name="legalBasisText"
                    value={currentSettings.legalBasisText || ''}
                    onChange={handleInputChange}
                    rows={3}
                    className="w-full p-2 text-sm border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                    placeholder="เช่น อาศัยอำนาจตามความในมาตรา 39 (1) แห่งพระราชบัญญัติระเบียบบริหารราชการกระทรวงศึกษาธิการ พ.ศ. 2546 และที่แก้ไขเพิ่มเติม และมาตรา 27 (1) แห่งพระราชบัญญัติระเบียบข้าราชการครูและบุคลากรทางการศึกษา พ.ศ. 2547 และที่แก้ไขเพิ่มเติม"
                />
            </div>
        </fieldset>

        <fieldset className="border border-slate-200 p-4 rounded-md min-w-0 w-full shrink">
            <legend className="text-md font-semibold text-slate-700 px-1 break-words max-w-full">วันจัดการเรียนการสอน</legend>
            <div className="flex flex-wrap gap-4 mt-2">
                {(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as DayOfWeek[]).map(day => (
                    <label key={day} className="flex items-center space-x-2">
                      <input 
                        type="checkbox"
                        checked={currentSettings.operatingDays?.includes(day) || false}
                        onChange={(e) => {
                            const isChecked = e.target.checked;
                            setCurrentSettings(prev => {
                                const currentDays = prev.operatingDays || [];
                                let newDays;
                                if (isChecked) {
                                    newDays = [...currentDays, day];
                                } else {
                                    newDays = currentDays.filter(d => d !== day);
                                }
                                // Ensure correct ordering
                                const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
                                newDays.sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
                                return { ...prev, operatingDays: newDays as DayOfWeek[] };
                            });
                        }}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-700">{day.substring(0, 3)}</span>
                    </label>
                ))}
            </div>
        </fieldset>

        <fieldset className="border border-slate-200 p-4 rounded-md min-w-0 w-full shrink">
            <legend className="text-md font-semibold text-slate-700 px-1 break-words max-w-full">ข้อมูลผู้บริหาร</legend>
            <div className="space-y-4 mt-2">
                <div>
                    <label htmlFor="directorName" className="block text-sm font-medium text-slate-700 mb-1">
                        ชื่อผู้อำนวยการ
                    </label>
                    <input
                        type="text"
                        id="directorName"
                        name="directorName"
                        value={currentSettings.directorName || ''}
                        onChange={handleInputChange}
                        className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                        placeholder="เช่น นายสมชาย รักเรียน"
                    />
                </div>
                <div>
                    <label htmlFor="directorPosition" className="block text-sm font-medium text-slate-700 mb-1">
                        ตำแหน่งผู้อำนวยการ
                    </label>
                    <input
                        type="text"
                        id="directorPosition"
                        name="directorPosition"
                        value={currentSettings.directorPosition || ''}
                        onChange={handleInputChange}
                        className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                        placeholder="เช่น ผู้อำนวยการโรงเรียน"
                    />
                </div>
                <div>
                    <label htmlFor="deputyDirectorName" className="block text-sm font-medium text-slate-700 mb-1">
                        ชื่อรองผู้อำนวยการ
                    </label>
                    <input
                        type="text"
                        id="deputyDirectorName"
                        name="deputyDirectorName"
                        value={currentSettings.deputyDirectorName || ''}
                        onChange={handleInputChange}
                        className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                        placeholder="เช่น นางสาวมณีวรรณ สอนดี"
                    />
                </div>
                <div>
                    <label htmlFor="deputyDirectorPosition" className="block text-sm font-medium text-slate-700 mb-1">
                        ตำแหน่งรองผู้อำนวยการ
                    </label>
                    <input
                        type="text"
                        id="deputyDirectorPosition"
                        name="deputyDirectorPosition"
                        value={currentSettings.deputyDirectorPosition || ''}
                        onChange={handleInputChange}
                        className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                        placeholder="เช่น รองผู้อำนวยการฝ่ายวิชาการ"
                    />
                </div>
            </div>
        </fieldset>

        {/* --- Academic Term Settings --- */}
        <fieldset className="border border-slate-200 p-6 rounded-xl bg-slate-50/50">
           <legend className="text-lg font-semibold text-slate-800 px-3 flex items-center bg-white rounded-md border border-slate-200 shadow-sm py-1">
               <Icons.Schedule size={20} className="mr-2 text-indigo-500" /> ตั้งค่าระยะเวลาภาคเรียน
           </legend>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
               <div>
                   <label htmlFor="semesterStartDate" className="block text-sm font-medium text-slate-700 mb-1">
                       วันเปิดภาคเรียน
                   </label>
                   <input
                       type="date"
                       id="semesterStartDate"
                       name="semesterStartDate"
                       value={currentSettings.semesterStartDate || ''}
                       onChange={handleInputChange}
                       className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                   />
               </div>
               <div>
                   <label htmlFor="semesterEndDate" className="block text-sm font-medium text-slate-700 mb-1">
                       วันปิดภาคเรียน
                   </label>
                   <input
                       type="date"
                       id="semesterEndDate"
                       name="semesterEndDate"
                       value={currentSettings.semesterEndDate || ''}
                       onChange={handleInputChange}
                       className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                   />
               </div>
           </div>
           <div className="mt-6">
               <label htmlFor="schoolHolidays" className="block text-sm font-medium text-slate-700 mb-1">
                   วันหยุดนักขัตฤกษ์ / วันหยุดพิเศษ (กรอก 1 วันต่อ 1 บรรทัด เช่น 2026-07-25)
               </label>
               <textarea
                   id="schoolHolidays"
                   name="schoolHolidays"
                   value={currentSettings.schoolHolidays || ''}
                   onChange={handleInputChange}
                   className="w-full h-32 p-3 font-mono border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm text-sm"
                   placeholder="2026-07-25&#10;2026-08-12"
               />
               <p className="text-xs text-slate-500 mt-2">รูปแบบวันที่ YYYY-MM-DD (เช่น 2026-07-25)</p>
           </div>
        </fieldset>

        {/* --- พิมพ์เอกสารราชการ (บันทึกข้อความ / คำสั่ง) --- */}
        <div className="border border-indigo-200 bg-gradient-to-r from-indigo-50/70 to-blue-50/70 p-6 rounded-xl shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-indigo-900 flex items-center gap-2">
                <Icons.Printer size={22} className="text-indigo-600" />
                พิมพ์เอกสารราชการ (บันทึกข้อความ / คำสั่งโรงเรียน)
              </h3>
              <p className="text-sm text-slate-600 mt-1">
                สร้างและดาวน์โหลดเอกสารราชการ A4 แบบฟอร์มมาตรฐาน (ฟอนต์ Sarabun พร้อมตราครุฑ) ตามข้อมูลที่ตั้งค่าไว้
              </p>
            </div>
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3">
              {/* กลุ่มบันทึกข้อความ */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => generateOfficialMemoPdf(currentSettings as OrganizationSettings)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-slate-50 text-indigo-700 font-medium rounded-lg border border-indigo-300 shadow-sm transition-all hover:shadow cursor-pointer text-sm"
                  title="พิมพ์บันทึกข้อความขออนุมัติคำสั่งสอน (A4 แนวตั้ง PDF)"
                >
                  <Icons.FileText size={17} className="text-indigo-600" />
                  <span>พิมพ์บันทึกข้อความ (PDF)</span>
                </button>

                <button
                  type="button"
                  onClick={() => generateOfficialMemoDocx(currentSettings as OrganizationSettings)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 font-medium rounded-lg border border-blue-300 shadow-sm transition-all hover:shadow cursor-pointer text-sm"
                  title="ดาวน์โหลดบันทึกข้อความขออนุมัติคำสั่งสอน (Word .docx)"
                >
                  <Icons.Download size={17} className="text-blue-700" />
                  <span>ดาวน์โหลดบันทึกข้อความ (Word)</span>
                </button>
              </div>

              {/* กลุ่มคำสั่ง */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => generateSchoolOrderPdf(currentSettings as OrganizationSettings)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg shadow-sm transition-all hover:shadow cursor-pointer text-sm"
                  title="พิมพ์คำสั่งปฏิบัติหน้าที่สอน (A4 แนวตั้ง PDF)"
                >
                  <Icons.FileText size={17} className="text-indigo-100" />
                  <span>พิมพ์คำสั่ง (PDF)</span>
                </button>

                <button
                  type="button"
                  onClick={() => generateSchoolOrderDocx(currentSettings as OrganizationSettings)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-medium rounded-lg border border-indigo-300 shadow-sm transition-all hover:shadow cursor-pointer text-sm"
                  title="ดาวน์โหลดคำสั่งปฏิบัติหน้าที่สอน (Word .docx)"
                >
                  <Icons.Download size={17} className="text-indigo-700" />
                  <span>ดาวน์โหลดคำสั่ง (Word)</span>
                </button>
              </div>
            </div>
          </div>
          
          <div className="mt-4 pt-3 border-t border-indigo-100/80 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-500">
            <div className="flex items-start gap-1.5">
              <span className="text-indigo-600 font-bold">•</span>
              <span><strong>บันทึกข้อความ:</strong> เอกสารขออนุมัติภายใน มีลำดับเซ็น 4 ตำแหน่ง (ผู้จัดทำ &gt; ผู้ตรวจ &gt; รอง ผอ. &gt; ผอ.)</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-indigo-600 font-bold">•</span>
              <span><strong>คำสั่งโรงเรียน:</strong> เอกสารคำสั่งแต่งตั้งและมอบหมายหน้าที่สอน (ผอ. ลงนามคนเดียว)</span>
            </div>
          </div>
        </div>

          <div className="sticky bottom-0 -mx-4 md:-mx-8 -mb-4 md:-mb-8 px-4 md:px-8 py-4 bg-white/90 backdrop-blur-md border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center space-y-3 sm:space-y-0 sm:space-x-3 z-10">
           <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
             <button
              type="button"
              onClick={requestClearAll}
              className={`w-full sm:w-auto px-4 py-2 text-sm font-medium transition-colors
                          ${permissions.canPerformManagerActions
                              ? 'text-red-600 bg-red-50 hover:bg-red-100 border border-red-300' 
                              : 'text-slate-400 bg-slate-100 border border-slate-300 cursor-not-allowed'}`}
              disabled={!permissions.canPerformManagerActions}
              title={permissions.canPerformManagerActions ? "ล้างข้อมูลทั้งหมด" : "ล็อกโดยระบบส่วนกลาง"}
            >
              ล้างข้อมูลทั้งหมด
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={requestResetSemester}
                className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-300 transition-colors rounded shadow-sm"
              >
                เริ่มภาคเรียนใหม่ (ล้างตารางสอน)
              </button>
            )}
           </div>
          {permissions.canPerformManagerActions && (
            <button
              type="submit"
              className="w-full sm:w-auto px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors"
            >
              บันทึกการเปลี่ยนแปลง
            </button>
          )}
        </div>
      </form>
      
      {/* Clear All Organization Data Modal (Two-Step with Mandatory Backup) */}
      {isConfirmClearModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                  <Icons.Warning size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">ยืนยันการลบข้อมูลหน่วยงานทั้งหมด</h3>
                  <p className="text-sm text-slate-500">ขั้นตอนการล้างข้อมูลและการตั้งค่าหน่วยงาน</p>
                </div>
              </div>
              
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800 font-medium">
                  คำเตือน: คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลหน่วยงานทั้งหมด? การดำเนินการนี้ไม่สามารถย้อนกลับได้ และจะคืนค่าเริ่มต้นบางส่วน กรุณาสำรองข้อมูลปัจจุบันก่อนทำรายการ
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-slate-700">ขั้นที่ 1: สำรองข้อมูล</p>
                    <p className="text-xs text-slate-500">ดาวน์โหลดข้อมูลทั้งหมดเก็บไว้ก่อน</p>
                    {hasDownloadedBackupForClear && (
                      <p className="text-xs text-emerald-600 font-medium mt-1">✓ บันทึกข้อมูลสำรองเรียบร้อยแล้ว</p>
                    )}
                  </div>
                  <button 
                    type="button"
                    onClick={handleDownloadBackupForClear}
                    disabled={isDownloadingBackupForClear}
                    className={`px-4 py-2 text-sm font-medium rounded transition-colors flex items-center gap-2 ${
                      isDownloadingBackupForClear
                        ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        : hasDownloadedBackupForClear
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isDownloadingBackupForClear ? (
                      <>
                        <span className="inline-block animate-spin">⏳</span>
                        <span>กำลังบันทึกข้อมูลสำรอง...</span>
                      </>
                    ) : hasDownloadedBackupForClear ? (
                      <span>ดาวน์โหลดอีกครั้ง</span>
                    ) : (
                      <span>ดาวน์โหลดข้อมูลสำรอง</span>
                    )}
                  </button>
                </div>

                <div className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${hasDownloadedBackupForClear ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50 opacity-50'}`}>
                  <div>
                    <p className={`text-sm font-medium ${hasDownloadedBackupForClear ? 'text-red-700' : 'text-slate-500'}`}>ขั้นที่ 2: ยืนยันการลบข้อมูล</p>
                    <p className="text-xs text-red-500/70">การกระทำนี้ย้อนกลับไม่ได้</p>
                  </div>
                  <button 
                    type="button"
                    onClick={confirmClearAll}
                    disabled={!hasDownloadedBackupForClear}
                    className={`px-4 py-2 text-sm font-medium rounded transition-colors ${hasDownloadedBackupForClear ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                  >
                    ลบข้อมูลทั้งหมด
                  </button>
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={handleCloseClearModal}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Semester Reset Modal */}
      {isResetSemesterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="flex-shrink-0 w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center text-amber-600">
                  <Icons.Warning size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">เริ่มภาคเรียนใหม่</h3>
                  <p className="text-sm text-slate-500">ขั้นตอนการเตรียมพร้อมสำหรับเทอมใหม่</p>
                </div>
              </div>
              
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800 font-medium">
                  คำเตือน: การดำเนินการนี้จะล้างข้อมูลตารางสอนและการมอบหมายงานทั้งหมดเพื่อเริ่มภาคเรียนใหม่ (รายชื่อครู วิชา ห้องเรียน จะยังคงอยู่) กรุณาสำรองข้อมูลปัจจุบันก่อนทำรายการ
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-slate-700">ขั้นที่ 1: สำรองข้อมูล</p>
                    <p className="text-xs text-slate-500">ดาวน์โหลดข้อมูลทั้งหมดเก็บไว้ก่อน</p>
                    {hasDownloadedBackup && (
                      <p className="text-xs text-emerald-600 font-medium mt-1">✓ บันทึกข้อมูลสำรองเรียบร้อยแล้ว</p>
                    )}
                  </div>
                  <button 
                    type="button"
                    onClick={handleDownloadBackup}
                    disabled={isDownloadingBackup}
                    className={`px-4 py-2 text-sm font-medium rounded transition-colors flex items-center gap-2 ${
                      isDownloadingBackup
                        ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        : hasDownloadedBackup
                          ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isDownloadingBackup ? (
                      <>
                        <span className="inline-block animate-spin">⏳</span>
                        <span>กำลังบันทึกข้อมูลสำรอง...</span>
                      </>
                    ) : hasDownloadedBackup ? (
                      <span>ดาวน์โหลดอีกครั้ง</span>
                    ) : (
                      <span>ดาวน์โหลดข้อมูลสำรอง</span>
                    )}
                  </button>
                </div>

                <div className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${hasDownloadedBackup ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50 opacity-50'}`}>
                  <div>
                    <p className={`text-sm font-medium ${hasDownloadedBackup ? 'text-red-700' : 'text-slate-500'}`}>ขั้นที่ 2: ยืนยันการล้างข้อมูล</p>
                    <p className="text-xs text-red-500/70">การกระทำนี้ย้อนกลับไม่ได้</p>
                  </div>
                  <button 
                    onClick={confirmResetSemester}
                    disabled={!hasDownloadedBackup || isResetting}
                    className={`px-4 py-2 text-sm font-medium rounded transition-colors ${hasDownloadedBackup ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                  >
                    {isResetting ? 'กำลังดำเนินการ...' : 'ยืนยันล้างตารางสอนเพื่อเริ่มเทอมใหม่'}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setIsResetSemesterModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default OrganizationSettingsScreen;