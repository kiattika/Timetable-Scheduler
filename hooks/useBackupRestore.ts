import { ChangeEvent } from 'react';
import { AppData } from '../types';

export const useBackupRestore = (appData: AppData | null, setAppData: (data: AppData) => void, setRestoreFile: (file: File | null) => void, setShowRestoreConfirm: (show: boolean) => void) => {
  const handleBackupData = () => {
    if (appData?.currentUser?.role !== 'admin') {
      alert("Only administrators can perform backups.");
      return;
    }
    if (!appData) {
        alert("No data to backup.");
        return;
    }

    try {
        const backupData = {
            backupVersion: 1,
            timestamp: new Date().toISOString(),
            schoolName: appData.organizationSettings?.name || "Unknown School",
            academicTerm: appData.organizationSettings?.academicYear || "Unknown Term",
            totalRecordCount: (appData.subjects?.length || 0) + (appData.teachers?.length || 0) + (appData.physicalRooms?.length || 0) + (appData.gradeLevels?.length || 0) + (appData.scheduleEntries?.length || 0),
            data: appData
        };

        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const date = new Date();
        const formattedDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
        const term = backupData.academicTerm.replace(/[^a-zA-Z0-9]/g, '');
        link.download = `timetable_backup_${term}_${formattedDate}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Backup failed:", error);
        alert("Backup failed. See console for details.");
    }
  };

  const handleRestoreData = async (event: ChangeEvent<HTMLInputElement>) => {
    if (appData?.currentUser?.role !== 'admin') {
      alert("Only administrators can restore data.");
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        const text = await file.text();
        const parsedData = JSON.parse(text);

        // Pre-validation
        if (!parsedData.data || !parsedData.data.teachers || !parsedData.data.physicalRooms || !parsedData.data.scheduleEntries) {
            alert("Error: Invalid or corrupted backup file. Mandatory data collections are missing.");
            event.target.value = "";
            return;
        }

        // Trigger confirmation flow
        setRestoreFile(file);
        setShowRestoreConfirm(true);
    } catch (e) {
        alert("Error: Invalid JSON format or corrupted file.");
    } finally {
        event.target.value = "";
    }
  };

  return { handleBackupData, handleRestoreData };
};
