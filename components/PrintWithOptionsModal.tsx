
import React, { useState, useEffect } from 'react';
import { PrintWithOptionsModalProps, PrintOptions, PrintItemScope, PrintLayoutOption, PrintOrientation, PrintOutputFormat, Identifiable, AppData } from '../types';
import Modal from './Modal';
import { Icons } from '../constants';

const PrintWithOptionsModal: React.FC<PrintWithOptionsModalProps> = ({
  isOpen,
  onClose,
  onConfirmPrint,
  itemType,
  currentItemId,
  allItems,
  appData,
}) => {
  const [scope, setScope] = useState<PrintItemScope>('current');
  const [layout, setLayout] = useState<PrintLayoutOption>('1_per_page');
  const [orientation, setOrientation] = useState<PrintOrientation>('landscape');
  const [outputFormat, setOutputFormat] = useState<PrintOutputFormat>('print');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      // Reset to default when modal opens, or pre-select current if applicable
      if (currentItemId && scope === 'current') {
        setSelectedItems([currentItemId]);
      } else if (scope === 'all') {
        setSelectedItems(allItems.map(item => item.id));
      } else {
        setSelectedItems([]); // For 'selected' initially empty or if currentItemId is null
      }
    }
  }, [isOpen, currentItemId, scope, allItems]);

  const handleScopeChange = (newScope: PrintItemScope) => {
    setScope(newScope);
    if (newScope === 'current' && currentItemId) {
      setSelectedItems([currentItemId]);
    } else if (newScope === 'all') {
      setSelectedItems(allItems.map(item => item.id));
    } else {
      // For 'selected', keep current selections or clear if switching from 'all'/'current'
      if (scope !== 'selected') {
         setSelectedItems([]);
      }
    }
  };

  const handleCheckboxChange = (itemId: string) => {
    setSelectedItems(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
    );
  };

  const handleSubmit = () => {
    if (selectedItems.length === 0 && (scope === 'selected' || (scope === 'current' && !currentItemId) )) {
        alert(`กรุณาเลือกรายการที่ต้องการพิมพ์อย่างน้อย 1 รายการ`);
        return;
    }
    onConfirmPrint({
      itemType,
      scope,
      selectedItemIds: scope === 'current' && currentItemId ? [currentItemId] : (scope === 'all' ? allItems.map(i => i.id) : selectedItems),
      layout,
      orientation,
      outputFormat,
    });
    onClose();
  };
  
  const getItemName = (itemId: string): string => {
    switch (itemType) {
        case 'teacher':
            return appData.teachers.find(t => t.id === itemId)?.name || itemId;
        case 'gradeLevel':
            return appData.gradeLevels.find(gl => gl.id === itemId)?.name || itemId;
        case 'physicalRoom':
            const room = appData.physicalRooms.find(c => c.id === itemId);
            return room ? room.name : itemId;
        default:
            return itemId;
    }
  };

  const currentItemName = currentItemId ? getItemName(currentItemId) : 'N/A';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`ตัวเลือกการพิมพ์และส่งออกตารางสอน (${itemType === 'teacher' ? 'ครูผู้สอน' : itemType === 'gradeLevel' ? 'ระดับชั้น' : 'ห้องเรียน'})`} size="lg">
      <div className="space-y-6 p-1">
        {/* Output Format Selector */}
        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-2">รูปแบบการส่งออก (Export Format)</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setOutputFormat('print')}
              className={`flex items-center justify-center p-3 rounded-lg border text-sm font-medium transition-all ${
                outputFormat === 'print'
                  ? 'border-blue-600 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
            >
              <Icons.Printer className="w-5 h-5 mr-2 text-blue-600" />
              <span>พิมพ์ผ่านเบราว์เซอร์ (Print)</span>
            </button>
            <button
              type="button"
              onClick={() => setOutputFormat('pdf')}
              className={`flex items-center justify-center p-3 rounded-lg border text-sm font-medium transition-all ${
                outputFormat === 'pdf'
                  ? 'border-red-600 bg-red-50 text-red-700 ring-2 ring-red-500/20'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
            >
              <Icons.FileText className="w-5 h-5 mr-2 text-red-600" />
              <span>ส่งออกไฟล์ PDF (Vector PDF)</span>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-2">ขอบเขตข้อมูล (Scope)</label>
          <div className="space-y-2">
            <label className="flex items-center space-x-2 text-sm text-slate-700">
              <input
                type="radio"
                name="scope"
                value="current"
                checked={scope === 'current'}
                onChange={() => handleScopeChange('current')}
                className="rounded-full border-slate-400 text-blue-600 focus:ring-blue-500"
                disabled={!currentItemId}
              />
              <span>เฉพาะรายการปัจจุบัน ({currentItemName})</span>
            </label>
            <label className="flex items-center space-x-2 text-sm text-slate-700">
              <input
                type="radio"
                name="scope"
                value="selected"
                checked={scope === 'selected'}
                onChange={() => handleScopeChange('selected')}
                className="rounded-full border-slate-400 text-blue-600 focus:ring-blue-500"
              />
              <span>เลือกเฉพาะรายการที่ต้องการ ({selectedItems.length} รายการ)</span>
            </label>
            <label className="flex items-center space-x-2 text-sm text-slate-700">
              <input
                type="radio"
                name="scope"
                value="all"
                checked={scope === 'all'}
                onChange={() => handleScopeChange('all')}
                className="rounded-full border-slate-400 text-blue-600 focus:ring-blue-500"
              />
              <span>ทั้งหมด ({allItems.length} รายการ)</span>
            </label>
          </div>
        </div>

        {scope === 'selected' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">เลือกรายการที่ต้องการพิมพ์:</label>
            <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-md p-2 space-y-1 bg-slate-50">
              {allItems.length > 0 ? allItems.map(item => (
                <label key={item.id} className="flex items-center space-x-2 text-sm text-slate-700 hover:bg-slate-100 p-1 rounded">
                  <input
                    type="checkbox"
                    checked={selectedItems.includes(item.id)}
                    onChange={() => handleCheckboxChange(item.id)}
                    className="rounded border-slate-400 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{getItemName(item.id)}</span>
                </label>
              )) : <p className="text-xs text-slate-500">ไม่มีรายการให้เลือก</p>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="orientation" className="block text-sm font-semibold text-slate-800 mb-1">การวางแนวกระดาษ (Orientation)</label>
            <select
              id="orientation"
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as PrintOrientation)}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm text-sm"
            >
              <option value="landscape">แนวนอน (Landscape) - แนะนำ</option>
              <option value="portrait">แนวตั้ง (Portrait)</option>
            </select>
          </div>

          <div>
            <label htmlFor="layout" className="block text-sm font-semibold text-slate-800 mb-1">การจัดวางต่อหน้า (Layout Grid Matrix)</label>
            <select
              id="layout"
              value={layout}
              onChange={(e) => setLayout(e.target.value as PrintLayoutOption)}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm text-sm"
            >
              <option value="1_per_page">1 ตาราง / หน้า (เต็มหน้า A4)</option>
              <option value="1x2_per_page">2 ตาราง / หน้า (บน-ล่าง)</option>
              <option value="2x2_per_page">4 ตาราง / หน้า (4 ส่วน)</option>
              <option value="2x3_per_page">6 ตาราง / หน้า (6 ส่วน)</option>
              <option value="2x4_per_page">8 ตาราง / หน้า (8 ส่วน)</option>
            </select>
          </div>
        </div>

        <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={scope === 'selected' && selectedItems.length === 0}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md shadow-sm transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center ${
              outputFormat === 'pdf' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {outputFormat === 'pdf' ? (
              <>
                <Icons.FileText size={16} className="mr-2" />
                ส่งออกไฟล์ PDF
              </>
            ) : (
              <>
                <Icons.Printer size={16} className="mr-2" />
                พิมพ์ตารางสอน
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default PrintWithOptionsModal;

