import { ChangeEvent, useState } from 'react';
import { AppData } from '../types';
import { buildTimetableBackupPayload, triggerJsonDownload } from '../utils/backup';

export const useBackupRestore = (
  appData: AppData | null, 
  setAppData: (data: AppData) => void, 
  setRestoreFile: (file: File | null) => void, 
  setShowRestoreConfirm: (show: boolean) => void
) => {
  const [isBackingUp, setIsBackingUp] = useState(false);

  const handleBackupData = async () => {
    if (appData?.currentUser?.role !== 'admin') {
      alert("เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถสำรองข้อมูลได้");
      return;
    }
    if (!appData) {
      alert("ไม่มีข้อมูลสำหรับสำรอง");
      return;
    }

    try {
      setIsBackingUp(true);
      // Give UI a moment to show in-progress state
      await new Promise(resolve => setTimeout(resolve, 50));
      const { backupData, filename } = buildTimetableBackupPayload(appData);
      triggerJsonDownload(backupData, filename);
      alert("บันทึกข้อมูลสำรองเรียบร้อยแล้ว\nไฟล์ถูกบันทึกไว้ในโฟลเดอร์ดาวน์โหลดของเบราว์เซอร์ (Downloads)");
    } catch (error) {
      console.error("Backup failed:", error);
      alert("เกิดข้อผิดพลาดในการสำรองข้อมูล");
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreData = async (event: ChangeEvent<HTMLInputElement>) => {
    if (appData?.currentUser?.role !== 'admin') {
      alert("เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถกู้คืนข้อมูลได้");
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsedData = JSON.parse(text);
      const raw = parsedData.data || parsedData;

      // Pre-validation of database structure
      if (!raw || typeof raw !== 'object') {
        alert("ข้อผิดพลาด: โครงสร้างไฟล์ข้อมูลไม่ถูกต้อง");
        event.target.value = "";
        return;
      }

      const hasValidData = 
        Array.isArray(raw.teachers) || 
        Array.isArray(raw.subjects) || 
        Array.isArray(raw.physicalRooms) || 
        Array.isArray(raw.gradeLevels) || 
        Array.isArray(raw.scheduleEntries) || 
        (raw.organizationSettings && typeof raw.organizationSettings === 'object');

      if (!hasValidData) {
        alert("ข้อผิดพลาด: ไฟล์สำรองข้อมูลไม่มีโครงสร้างตารางข้อมูลที่รองรับ (ไม่พบตารางครู, รายวิชา, ห้องเรียน, หรือตารางสอน)");
        event.target.value = "";
        return;
      }

      // Trigger confirmation modal
      setRestoreFile(file);
      setShowRestoreConfirm(true);
    } catch (e) {
      alert("ข้อผิดพลาด: รูปแบบไฟล์ JSON ไม่ถูกต้อง หรือไฟล์ได้รับความเสียหาย");
    } finally {
      event.target.value = "";
    }
  };

  return { handleBackupData, handleRestoreData, isBackingUp };
};

