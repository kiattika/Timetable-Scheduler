
import React, { useState, FormEvent, useEffect } from 'react';
import { AppData, GradeLevel, ScreenAccessProps } from '../types';
import { Icons } from '../constants';
import ConfirmationModal from './ConfirmationModal';

interface AcademicStructureScreenProps extends ScreenAccessProps {
  appData: AppData;
  setAppData: React.Dispatch<React.SetStateAction<AppData>>;
}

const BASE_GRADE_LEVELS = ["P.1", "P.2", "P.3", "P.4", "P.5", "P.6", "M.1", "M.2", "M.3", "M.4", "M.5", "M.6"];

const AcademicStructureScreen: React.FC<AcademicStructureScreenProps> = ({
  appData,
  setAppData,
  permissions,
}) => {
  const [roomCounts, setRoomCounts] = useState<Record<string, number>>({});
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [isConfirmGenerateModalOpen, setIsConfirmGenerateModalOpen] = useState(false);
  const [isConfirmClearChildrenModalOpen, setIsConfirmClearChildrenModalOpen] = useState(false);
  const [parentGradeToClear, setParentGradeToClear] = useState<string | null>(null);


  useEffect(() => {
    const initialCounts: Record<string, number> = {};
    BASE_GRADE_LEVELS.forEach(baseGrade => {
        const children = appData.gradeLevels.filter(gl => gl.name.startsWith(`${baseGrade}/`));
        initialCounts[baseGrade] = children.length;
    });
    setRoomCounts(initialCounts);
  }, [appData.gradeLevels]);


  if (!permissions.canPerformManagerActions) {
    return (
      <div className="p-4 md:p-6 bg-white shadow-lg rounded-lg">
        <h2 className="text-xl font-semibold text-red-600">Access Denied</h2>
        <p className="text-slate-600">Only managers can access academic structure settings.</p>
      </div>
    );
  }

  const handleRoomCountChange = (baseGrade: string, count: string) => {
    const numCount = parseInt(count, 10);
    setRoomCounts(prev => ({
      ...prev,
      [baseGrade]: isNaN(numCount) || numCount < 0 ? 0 : numCount,
    }));
    setFeedbackMessage(null);
    setErrorMessage(null);
  };

  const requestGenerateGradeLevels = (e: FormEvent) => {
    e.preventDefault();
    setFeedbackMessage(null);
    setErrorMessage(null);
    const counts = Object.values(roomCounts) as number[];
    const totalToGenerate = counts.reduce((sum, count) => sum + count, 0) + BASE_GRADE_LEVELS.length;
    if (totalToGenerate === 0 && !counts.some(c => c > 0)) {
        setErrorMessage("Please specify number of rooms for at least one grade level.");
        return;
    }
    setIsConfirmGenerateModalOpen(true);
  };
  
  const executeGenerateGradeLevels = () => {
    setIsProcessing(true);
    let newGradeLevels: GradeLevel[] = [...appData.gradeLevels];
    let parentGradesAdded = 0;
    let childGradesAdded = 0;
    let childGradesSkipped = 0;

    BASE_GRADE_LEVELS.forEach(baseGradeName => {
      const numberOfRooms = roomCounts[baseGradeName] || 0;
      
      if (numberOfRooms === 0) {
        return; // Skip generation if 0 rooms requested
      }

      // Ensure parent grade exists
      let parentGrade = newGradeLevels.find(gl => gl.name === baseGradeName);
      if (!parentGrade) {
        parentGrade = { id: crypto.randomUUID(), name: baseGradeName };
        newGradeLevels.push(parentGrade);
        parentGradesAdded++;
      }

      // Generate child grades
      for (let i = 1; i <= numberOfRooms; i++) {
        const childGradeName = `${baseGradeName}/${i}`;
        if (!newGradeLevels.some(gl => gl.name === childGradeName)) {
          newGradeLevels.push({ id: crypto.randomUUID(), name: childGradeName });
          childGradesAdded++;
        } else {
          childGradesSkipped++;
        }
      }
    });

    newGradeLevels.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    setAppData(prev => ({ ...prev, gradeLevels: newGradeLevels }));
    setFeedbackMessage(`Generation complete. Parent grades added: ${parentGradesAdded}. Child grades added: ${childGradesAdded}. Child grades skipped (already exist): ${childGradesSkipped}.`);
    setIsProcessing(false);
  };

  const requestClearChildGrades = (baseGrade: string) => {
    setParentGradeToClear(baseGrade);
    setIsConfirmClearChildrenModalOpen(true);
  };

  const executeClearChildGrades = () => {
    if (!parentGradeToClear) return;
    
    setIsProcessing(true);
    let gradesToKeep = appData.gradeLevels.filter(gl => !gl.name.startsWith(`${parentGradeToClear}/`));
    setAppData(prev => ({ ...prev, gradeLevels: gradesToKeep }));
    
    setRoomCounts(prev => ({ ...prev, [parentGradeToClear!]: 0 })); // Reset count for this grade
    setFeedbackMessage(`Child grades for ${parentGradeToClear} have been cleared.`);
    setIsProcessing(false);
    setParentGradeToClear(null);
  };


  return (
    <div className="p-4 md:p-6 bg-white shadow-lg rounded-lg w-full">
      <div className="flex items-center mb-6">
        <Icons.Layers size={32} className="mr-3 text-blue-600" />
        <h2 className="text-2xl font-semibold text-slate-800">กำหนดโครงสร้างระดับชั้นและห้องเรียน</h2>
      </div>

      {feedbackMessage && <p className="mb-4 text-sm text-green-600 bg-green-50 p-3 rounded-md border border-green-200">{feedbackMessage}</p>}
      {errorMessage && <p className="mb-4 text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200">{errorMessage}</p>}

      <form onSubmit={requestGenerateGradeLevels} className="space-y-6">
        <p className="text-sm text-slate-600">
          ระบุจำนวนห้องเรียนสำหรับแต่ละระดับชั้นหลัก (เช่น M.1, M.2) ระบบจะสร้างระดับชั้นหลักและระดับชั้นย่อย (ห้องเรียน) ให้อัตโนมัติ
          ตัวอย่าง: หากระบุ M.1 จำนวน 3 ห้อง จะมีการสร้าง "M.1", "M.1/1", "M.1/2", และ "M.1/3".
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {BASE_GRADE_LEVELS.map(baseGrade => {
          const childGrades = appData.gradeLevels
            .filter(gl => gl.name.startsWith(`${baseGrade}/`))
            .sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
          return (
          <div key={baseGrade} className="flex flex-col border border-slate-200 rounded-lg bg-white shadow-sm overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <span className="font-semibold text-slate-800">{baseGrade}</span>
              <span className="text-xs text-slate-500">{childGrades.length} ห้อง</span>
            </div>
            <div className="p-3 space-y-2">
              <label htmlFor={`rooms_${baseGrade}`} className="block text-xs font-medium text-slate-600">
                จำนวนห้อง
              </label>
              <input
                type="number"
                id={`rooms_${baseGrade}`}
                name={`rooms_${baseGrade}`}
                value={roomCounts[baseGrade] || 0}
                onChange={(e) => handleRoomCountChange(baseGrade, e.target.value)}
                min="0"
                className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                disabled={isProcessing}
              />
              {childGrades.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {childGrades.map(child => (
                    <span key={child.id} className="px-2 py-0.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded">
                      {child.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 pt-1">ยังไม่มีห้องเรียน</p>
              )}
            </div>
            <div className="mt-auto px-3 pb-3">
              <button
                  type="button"
                  onClick={() => requestClearChildGrades(baseGrade)}
                  disabled={isProcessing || (roomCounts[baseGrade] || 0) === 0}
                  className="text-xs text-red-500 hover:text-red-700 underline disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed"
                  title={`ลบห้องเรียนทั้งหมดของ ${baseGrade} (เช่น ${baseGrade}/1, ${baseGrade}/2, ...)`}
              >
                  ล้างห้องของ {baseGrade}
              </button>
            </div>
          </div>
        )})}
        </div>

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={isProcessing}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center"
          >
            {isProcessing ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing...
              </>
            ) : (
             <> <Icons.Add size={18} className="mr-2"/> สร้าง/อัปเดตระดับชั้น</>
            )}
          </button>
        </div>
      </form>
      
      <ConfirmationModal
        isOpen={isConfirmGenerateModalOpen}
        onClose={() => setIsConfirmGenerateModalOpen(false)}
        onConfirm={() => {
            executeGenerateGradeLevels();
            // setIsConfirmGenerateModalOpen(false); // Handled by modal's own onConfirm
        }}
        title="ยืนยันการสร้างระดับชั้น"
        message="ระบบจะสร้างระดับชั้นหลักและห้องเรียนตามจำนวนที่ระบุ หากมีระดับชั้นชื่อเดียวกันอยู่แล้ว จะไม่สร้างซ้ำ คุณต้องการดำเนินการต่อหรือไม่?"
        confirmButtonText="ดำเนินการสร้าง"
        confirmButtonVariant="primary"
        icon={Icons.Layers}
      />

      <ConfirmationModal
        isOpen={isConfirmClearChildrenModalOpen}
        onClose={() => {
            setIsConfirmClearChildrenModalOpen(false);
            setParentGradeToClear(null);
        }}
        onConfirm={() => {
            executeClearChildGrades();
            // setIsConfirmClearChildrenModalOpen(false); // Handled by modal's own onConfirm
        }}
        title={`ยืนยันการล้างห้องของ ${parentGradeToClear || ''}`}
        message={`คุณแน่ใจหรือไม่ว่าต้องการลบห้องเรียนทั้งหมดของ ${parentGradeToClear || ''} (เช่น ${parentGradeToClear}/1, ${parentGradeToClear}/2, ...)? การดำเนินการนี้ไม่สามารถย้อนกลับได้ และอาจส่งผลต่อตารางสอนที่มีอยู่`}
        confirmButtonText="ใช่ ล้างห้องเรียน"
        confirmButtonVariant="danger"
        icon={Icons.Warning}
      />

    </div>
  );
};

export default AcademicStructureScreen;
