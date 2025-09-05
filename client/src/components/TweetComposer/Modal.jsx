import React from 'react';

// Modal as a floating popup (bottom right corner, no overlay)
const Modal = ({ isOpen, onClose, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed bottom-8 right-8 z-50 max-w-md w-full">
      <div className="bg-white rounded-lg shadow-lg p-6 relative animate-fade-in border border-gray-200">
        <button
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-xl font-bold"
          onClick={onClose}
          aria-label="Close modal"
        >
          &times;
        </button>
        {children}
      </div>
    </div>
  );
};

export default Modal;
