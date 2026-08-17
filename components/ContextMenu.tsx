import React, { useEffect, useRef } from 'react';
import { ContextMenuItemAction } from '../types';

interface ContextMenuProps {
  x: number;
  y: number;
  isOpen: boolean;
  items: ContextMenuItemAction[];
  onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, isOpen, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Adjust position if menu would go off-screen
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    top: y,
    left: x,
    zIndex: 1000,
  };
  
  // Basic off-screen detection (can be improved)
  if (menuRef.current) {
    const menuRect = menuRef.current.getBoundingClientRect();
    if (x + menuRect.width > window.innerWidth) {
      menuStyle.left = window.innerWidth - menuRect.width - 5; // 5px buffer
    }
    if (y + menuRect.height > window.innerHeight) {
      menuStyle.top = window.innerHeight - menuRect.height - 5; // 5px buffer
    }
  }


  return (
    <div
      ref={menuRef}
      style={menuStyle}
      className="bg-white shadow-2xl rounded-md border border-slate-200 min-w-[180px] py-1"
      role="menu"
      aria-orientation="vertical"
      aria-labelledby="options-menu"
    >
      {items.map((item, index) => {
        if (item.isSeparator) {
          return <div key={`separator-${index}`} className="border-t border-slate-200 my-1 mx-1"></div>;
        }
        const IconComponent = item.icon;
        return (
          <button
            key={item.label}
            onClick={() => {
              item.action();
              onClose();
            }}
            disabled={item.disabled}
            className={`w-full text-left px-3 py-1.5 text-sm flex items-center
                        ${item.disabled 
                            ? 'text-slate-400 cursor-not-allowed' 
                            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus:bg-slate-100 focus:outline-none'
                        } transition-colors duration-100`}
            role="menuitem"
          >
            {IconComponent && <IconComponent size={16} className="mr-2.5 flex-shrink-0" />}
            <span className="flex-grow">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ContextMenu;