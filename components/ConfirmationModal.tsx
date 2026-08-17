
import React from 'react';
import Modal from './Modal';
import { Icons } from '../constants';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void; // Also acts as onCancel
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmButtonText?: string;
  cancelButtonText?: string;
  confirmButtonVariant?: 'danger' | 'primary';
  icon?: React.ElementType;
  hideCancelButton?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmButtonText = 'Confirm',
  cancelButtonText = 'Cancel',
  confirmButtonVariant = 'danger',
  icon: Icon,
  hideCancelButton = false,
}) => {
  if (!isOpen) return null;

  const confirmButtonClasses = {
    danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    primary: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" size="sm">
      <div className="text-center">
        {Icon && <Icon size={48} className={`mx-auto mb-4 ${confirmButtonVariant === 'danger' ? 'text-red-500' : 'text-blue-500'}`} />}
        <h3 className="text-lg font-semibold text-slate-800 mb-2">{title}</h3>
        <div className="text-sm text-slate-600 mb-6 whitespace-pre-wrap">
          {message}
        </div>
      </div>
      <div className="sticky bottom-0 -mx-4 md:-mx-6 -mb-4 md:-mb-6 px-4 md:px-6 py-4 bg-white border-t border-slate-100 flex justify-end gap-3 z-10 mt-6 rounded-b-lg">
        {!hideCancelButton && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              {cancelButtonText}
            </button>
        )}
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose(); // Typically, confirmation modal closes after action
          }}
          className={`px-4 py-2 text-sm font-medium text-white rounded-md shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${confirmButtonClasses[confirmButtonVariant]}`}
        >
          {confirmButtonText}
        </button>
      </div>
    </Modal>
  );
};

export default ConfirmationModal;
