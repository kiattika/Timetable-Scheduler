
import React from 'react';
import { Icons } from '../constants';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'md' }) => {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex justify-center items-center z-50 p-2 sm:p-4">
      <div className={`bg-white rounded-lg shadow-xl w-[95vw] md:w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col transform transition-all mx-auto`}>
        <div className="flex justify-between items-center p-4 border-b border-slate-200 shrink-0">
          <h3 className="text-xl font-semibold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close modal"
          >
            <Icons.Close size={24} />
          </button>
        </div>
        <div className="p-4 md:p-6 overflow-y-auto flex-1 relative min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;
