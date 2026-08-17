import React, { useRef, useEffect } from 'react';
import { ScheduleEntry, DayOfWeek } from '../types';

interface TouchDragOptions {
  onDragStartInternal: (e: any, entryId: string, entryData: ScheduleEntry) => void;
  onDropInternal: (day: DayOfWeek, periodIndex: number, targetContext: { gradeLevelId?: string, teacherId?: string, physicalRoomId?: string }) => void;
  onDragEndInternal: (e: any) => void;
}

export function useTouchDrag({ onDragStartInternal, onDropInternal, onDragEndInternal }: TouchDragOptions) {
  const dragState = useRef<{ isDragging: boolean, entryId: string, entryData: ScheduleEntry, ghost: HTMLElement | null, startX: number, startY: number, hasMoved: boolean, originalTarget: HTMLElement | null } | null>(null);

  // Global non-passive touchmove to prevent scrolling while dragging
  useEffect(() => {
    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (dragState.current?.isDragging && dragState.current?.ghost) {
        e.preventDefault(); // This works because listener is { passive: false }
        
        const ghost = dragState.current.ghost;
        const touch = e.touches[0];
        // Center the ghost under the finger approximately
        const newX = touch.clientX - (ghost.offsetWidth / 2);
        const newY = touch.clientY - (ghost.offsetHeight / 2);
        ghost.style.left = `${newX}px`;
        ghost.style.top = `${newY}px`;
      }
    };

    document.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
    return () => {
      document.removeEventListener('touchmove', handleGlobalTouchMove);
    };
  }, []);

  const startTouchDrag = (e: React.TouchEvent, entryId: string, entryData: ScheduleEntry) => {
    dragState.current = {
      isDragging: false,
      hasMoved: false,
      entryId,
      entryData,
      ghost: null,
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      originalTarget: e.currentTarget as HTMLElement
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragState.current) return;
    
    const touch = e.touches[0];
    const dx = touch.clientX - dragState.current.startX;
    const dy = touch.clientY - dragState.current.startY;
    
    // Only start dragging if moved beyond a threshold (e.g., 10px) to distinguish from tap/long-press
    if (!dragState.current.isDragging && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      dragState.current.isDragging = true;
      dragState.current.hasMoved = true;
      
      const target = dragState.current.originalTarget;
      if (!target) return;

      const rect = target.getBoundingClientRect();
      
      const clone = target.cloneNode(true) as HTMLElement;
      clone.style.position = 'fixed';
      clone.style.top = `${rect.top}px`;
      clone.style.left = `${rect.left}px`;
      clone.style.width = `${rect.width}px`;
      clone.style.height = `${rect.height}px`;
      clone.style.opacity = '0.7';
      clone.style.pointerEvents = 'none'; // so we can use elementFromPoint
      clone.style.zIndex = '9999';
      clone.id = 'touch-drag-ghost';
      document.body.appendChild(clone);
      
      dragState.current.ghost = clone;
      
      // We pass a fake event to dragStart to set the opacity and styling
      onDragStartInternal(
        { dataTransfer: { setData: () => {}, effectAllowed: '' }, currentTarget: target, preventDefault: () => {} }, 
        dragState.current.entryId, 
        dragState.current.entryData
      );
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!dragState.current) return;

    if (dragState.current.isDragging && dragState.current.ghost) {
      const touch = e.changedTouches[0];
      
      // Hide ghost temporarily to find element underneath
      dragState.current.ghost.style.display = 'none';
      const targetElement = document.elementFromPoint(touch.clientX, touch.clientY);
      dragState.current.ghost.style.display = 'block';

      if (targetElement) {
        const cell = targetElement.closest('td[data-droppable="true"]');
        if (cell) {
          const day = cell.getAttribute('data-day') as DayOfWeek;
          const periodIndex = parseInt(cell.getAttribute('data-period') || '-1', 10);
          const gradeLevelId = cell.getAttribute('data-grade-level-id') || undefined;
          const teacherId = cell.getAttribute('data-teacher-id') || undefined;
          const physicalRoomId = cell.getAttribute('data-physical-room-id') || undefined;
          
          if (day && periodIndex >= 0) {
            onDropInternal(day, periodIndex, { gradeLevelId, teacherId, physicalRoomId });
          }
        }
      }

      dragState.current.ghost.remove();
      // Fake event for dragEnd to cleanup styling
      onDragEndInternal({ currentTarget: dragState.current.originalTarget });
    }
    
    dragState.current = null;
  };

  return { startTouchDrag, handleTouchMove, handleTouchEnd };
}
