import React, { useState } from 'react';

const Collapsible = ({ title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded mb-2 bg-gray-50">
      <button
        className="w-full flex items-center justify-between px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        <span className="font-semibold text-gray-800 text-left truncate">{title}</span>
        <span className="ml-2 text-blue-500 text-lg">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
};

export default Collapsible;
