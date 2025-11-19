import React, { useRef, useEffect } from 'react';
import './MobileControls.scss';

const MobileControls = ({ onMove, onAction, onMenu, onBelt }) => {
  const joystickRef = useRef(null);
  const joystickPadRef = useRef(null);
  const isTouching = useRef(false);
  const touchId = useRef(null);
  const startPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const joystick = joystickRef.current;
    const joystickPad = joystickPadRef.current;

    const handleTouchStart = (e) => {
      if (isTouching.current) return;
      
      const touch = e.touches[0];
      touchId.current = touch.identifier;
      isTouching.current = true;
      
      const rect = joystick.getBoundingClientRect();
      startPos.current = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };

      joystickPad.style.display = 'block';
      joystickPad.style.left = '50%';
      joystickPad.style.top = '50%';
      joystickPad.style.transform = 'translate(-50%, -50%)';
    };

    const handleTouchMove = (e) => {
      if (!isTouching.current) return;

      const touch = Array.from(e.touches).find(t => t.identifier === touchId.current);
      if (!touch) return;

      const rect = joystick.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const deltaX = touch.clientX - centerX;
      const deltaY = touch.clientY - centerY;
      
      const distance = Math.min(Math.sqrt(deltaX * deltaX + deltaY * deltaY), rect.width / 2);
      const angle = Math.atan2(deltaY, deltaX);
      
      const moveX = (distance * Math.cos(angle)) / (rect.width / 2);
      const moveY = (distance * Math.sin(angle)) / (rect.height / 2);
      
      // Update joystick pad position
      joystickPad.style.left = `${50 + (moveX * 50)}%`;
      joystickPad.style.top = `${50 + (moveY * 50)}%`;
      
      // Send movement data to game
      if (onMove) {
        onMove(moveX, moveY);
      }
    };

    const handleTouchEnd = () => {
      isTouching.current = false;
      touchId.current = null;
      joystickPad.style.display = 'none';
      
      // Stop movement
      if (onMove) {
        onMove(0, 0);
      }
    };

    joystick.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      joystick.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [onMove]);

  return (
    <div className="mobile-controls">
      {/* Virtual Joystick */}
      <div className="joystick-area" ref={joystickRef}>
        <div className="joystick-pad" ref={joystickPadRef}></div>
      </div>

      {/* Action Buttons */}
      <div className="action-buttons">
        <button 
          className="action-btn attack-btn"
          onTouchStart={() => onAction && onAction('attack')}
        >
          ⚔️
        </button>
        <button 
          className="action-btn interact-btn"
          onTouchStart={() => onAction && onAction('interact')}
        >
          ✋
        </button>
        <button 
          className="action-btn potion-btn"
          onTouchStart={() => onAction && onAction('potion')}
        >
          🧪
        </button>
      </div>

      {/* Menu Buttons */}
      <div className="menu-buttons">
        <button 
          className="menu-btn inventory-btn"
          onTouchStart={() => onMenu && onMenu('inventory')}
        >
          🎒
        </button>
        <button 
          className="menu-btn character-btn"
          onTouchStart={() => onMenu && onMenu('character')}
        >
          👤
        </button>
        <button 
          className="menu-btn spell-btn"
          onTouchStart={() => onMenu && onMenu('spell')}
        >
          🔮
        </button>
        <button 
          className="menu-btn map-btn"
          onTouchStart={() => onMenu && onMenu('map')}
        >
          🗺️
        </button>
      </div>

      {/* Belt Items */}
      <div className="belt-items">
        {[1, 2, 3, 4].map((slot) => (
          <button
            key={slot}
            className="belt-slot"
            onTouchStart={() => onBelt && onBelt(slot)}
          >
            {slot}
          </button>
        ))}
      </div>
    </div>
  );
};

export default MobileControls;