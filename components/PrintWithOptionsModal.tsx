
import React, { useState, useEffect } from 'react';
import { PrintWithOptionsModalProps, PrintOptions, PrintItemScope, PrintLayoutOption, PrintOrientation, Identifiable, AppData } from '../types';
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
      // This logic might need adjustment based on desired UX for 'selected' scope
      if (scope !== 'selected') { // If changing TO 'selected' from something else
         setSelectedItems([]); // Start fresh for 'selected'
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
        alert(`Please select at least one ${itemType} to print.`);
        return;
    }
    onConfirmPrint({
      itemType,
      scope,
      selectedItemIds: scope === 'current' && currentItemId ? [currentItemId] : (scope === 'all' ? allItems.map(i => i.id) : selectedItems),
      layout,
      orientation,
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
  }

  const currentItemName = currentItemId ? getItemName(currentItemId) : 'N/A';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Print Options for ${itemType.replace(/([A-Z])/g, ' $1')}`} size="lg">
      <div className="space-y-6 p-1">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Scope</label>
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
              <span>Print Current {itemType}: {currentItemName}</span>
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
              <span>Select specific {itemType}s to print</span>
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
              <span>Print all {itemType}s ({allItems.length})</span>
            </label>
          </div>
        </div>

        {scope === 'selected' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Select {itemType}s:</label>
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
              )) : <p className="text-xs text-slate-500">No {itemType}s available to select.</p>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="orientation" className="block text-sm font-medium text-slate-700 mb-1">Orientation</label>
            <select
              id="orientation"
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as PrintOrientation)}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>

          <div>
            <label htmlFor="layout" className="block text-sm font-medium text-slate-700 mb-1">Layout Grid Matrix</label>
            <select
              id="layout"
              value={layout}
              onChange={(e) => setLayout(e.target.value as PrintLayoutOption)}
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 shadow-sm"
            >
              <option value="1_per_page">Single page (1 block)</option>
              <option value="1x2_per_page">Vertical split (1x2 block)</option>
              <option value="2x2_per_page">Four quadrants (2x2 blocks)</option>
              <option value="2x3_per_page">Six blocks (2x3 blocks)</option>
              <option value="2x4_per_page">Eight blocks (2x4 blocks)</option>
            </select>
          </div>
        </div>

        <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={scope === 'selected' && selectedItems.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center"
          >
            <Icons.Printer size={16} className="mr-2" />
            Confirm Print
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default PrintWithOptionsModal;
