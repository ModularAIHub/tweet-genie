import React, { useState } from "react";

const Delete = ({ isOpen, tweet, onDelete, onCancel }) => {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
    } catch (error) {
      console.error("Delete failed:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center z-50 transition-all duration-300"
      onClick={onCancel}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl p-8 relative w-[90vw] max-w-md transform transition-all duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full w-8 h-8 flex items-center justify-center transition-colors duration-200 cursor-pointer"
          onClick={onCancel}
          disabled={isDeleting}
          aria-label="Close"
        >
          ×
        </button>

        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Delete Tweet?
          </h2>
          <div className="w-12 h-1 bg-red-500 rounded-full"></div>
        </div>

        {/* Content */}
        <div className="mb-6 space-y-3">
          <p className="text-gray-700">
            Are you sure you want to delete this tweet?
          </p>
          
          {tweet?.content && (
            <div className="bg-gray-50 border-l-4 border-red-500 p-3 rounded-r-lg">
              <p className="text-gray-800 font-medium text-sm">
                {tweet.content.substring(0, 100)}
                {tweet.content.length > 100 ? '...' : ''}
              </p>
            </div>
          )}
          
          <p className="text-sm text-gray-500 flex items-start gap-2">
            <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>This will permanently delete the tweet from both your Twitter account and history.</span>
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            className="flex-1 bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors duration-200 shadow-sm hover:shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Deleting...
              </>
            ) : (
              'Delete Tweet'
            )}
          </button>
          <button
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-3 rounded-lg font-semibold transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default Delete;
