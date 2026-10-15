
import React, { useEffect } from 'react';
import { Icons } from '../constants';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'md' }) => {
  // Lock page scroll behind the dialog
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg lg:max-w-2xl',
    xl: 'max-w-xl lg:max-w-4xl',
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex justify-center items-center z-50 p-2 sm:p-4" role="dialog" aria-modal="true">
      <div className={`bg-white rounded-lg shadow-xl w-full ${sizeClasses[size]} max-h-[92vh] max-h-[92dvh] flex flex-col transform transition-all mx-auto overflow-hidden`}>
        <div className="flex justify-between items-center p-4 border-b border-slate-200 shrink-0">
          <h3 className="text-lg sm:text-xl font-semibold text-slate-800 min-w-0 break-words pr-2">{title}</h3>
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
