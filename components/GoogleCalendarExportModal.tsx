
import React, { useState, FormEvent } from 'react';
import { AppData, Teacher, GCalExportOptions } from '../types';
import Modal from './Modal';
import { Icons } from '../constants';
import { exportToGoogleCalendar } from '../lib/GoogleCalendarApi';

interface GoogleCalendarExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  appData: AppData;
  onExport: (options: GCalExportOptions) => void;
}

const GoogleCalendarExportModal: React.FC<GoogleCalendarExportModalProps> = ({
  isOpen,
  onClose,
  appData,
}) => {
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>(() => {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 180); // Default to one semester later
    return nextWeek.toISOString().slice(0, 10);
  });
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleTeacherSelectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const options = event.target.options;
    const value: string[] = [];
    for (let i = 0, l = options.length; i < l; i++) {
      if (options[i].selected) {
        value.push(options[i].value);
      }
    }
    setSelectedTeacherIds(value);
  };

  const handlePrepare = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (new Date(startDate) > new Date(endDate)) {
      setError("Start date cannot be after end date.");
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirmExport = async () => {
    
    setIsExporting(true);
    setProgress("Starting export...");
    setError(null);
    try {
      await exportToGoogleCalendar(appData, selectedTeacherIds, startDate, endDate, setProgress);
      setProgress("Export successful!");
      setTimeout(() => {
        onClose();
        setProgress(null);
        setIsExporting(false);
        setShowConfirm(false);
      }, 1500);
    } catch (err: any) {
        setError(err.message || "An error occurred during export.");
        setProgress(null);
        setIsExporting(false);
        setShowConfirm(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={!isExporting ? onClose : () => {}} title="Export to Calendar" size="md">
      {!showConfirm ? (
        <form onSubmit={handlePrepare} className="space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200">{error}</p>}
          {progress && <p className="text-sm text-green-600 bg-green-50 p-3 rounded-md border border-green-200">{progress}</p>}
          
          <div>
            <label htmlFor="gcalTeachers" className="block text-sm font-medium text-slate-700 mb-1">
              Select Teachers (Leave blank to export all)
            </label>
            <select
              id="gcalTeachers"
              multiple
              value={selectedTeacherIds}
              onChange={handleTeacherSelectionChange}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
              size={5}
            >
              {appData.teachers.map(teacher => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name} {teacher.teacherCode && `(${teacher.teacherCode})`}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">Hold Ctrl/Cmd to select multiple.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="gcalStartDate" className="block text-sm font-medium text-slate-700 mb-1">
                Semester Start Date
              </label>
              <input
                type="date"
                id="gcalStartDate"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                required
              />
            </div>
            <div>
              <label htmlFor="gcalEndDate" className="block text-sm font-medium text-slate-700 mb-1">
                Semester End Date
              </label>
              <input
                type="date"
                id="gcalEndDate"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                required
              />
            </div>
          </div>
          
          <div className="pt-2 text-xs text-slate-500">
              <strong>Note:</strong> Events will be created on your primary Google Calendar, and teachers will be added as attendees so it appears on their calendars too.
          </div>

          <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10 mt-6">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isExporting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors flex items-center"
            >
              <Icons.Calendar size={16} className="mr-2" />
              Next
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
            {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200">{error}</p>}
            {progress && <p className="text-sm text-green-600 bg-green-50 p-3 rounded-md border border-green-200">{progress}</p>}
            <h3 className="text-lg font-medium">Verify Export Options</h3>
            <p className="text-sm text-slate-700">
                You are about to export schedule entries to Google Calendar.
                The events will be created from <strong>{startDate}</strong> until <strong>{endDate}</strong>.
            </p>
            <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10 mt-6">
                <button
                    type="button"
                    onClick={() => setShowConfirm(false)}
                    disabled={isExporting}
                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
                >
                    Back
                </button>
                <button
                    onClick={handleConfirmExport}
                    disabled={isExporting}
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md shadow-sm transition-colors"
                >
                    Confirm & Export
                </button>
            </div>
        </div>
      )}
    </Modal>
  );
};

export default GoogleCalendarExportModal;
