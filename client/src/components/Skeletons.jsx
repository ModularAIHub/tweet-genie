import React from 'react';

// Reusable skeleton primitive
const SkeletonBlock = ({ className = '' }) => (
  <div className={`animate-pulse bg-gray-200 rounded ${className}`} />
);

// Dashboard skeleton
export const DashboardSkeleton = () => (
  <div className="space-y-6">
    {/* Stats row */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-8 w-8 rounded-full" />
          </div>
          <SkeletonBlock className="h-8 w-16 mb-2" />
          <SkeletonBlock className="h-3 w-32" />
        </div>
      ))}
    </div>
    {/* Quick actions */}
    <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
      <SkeletonBlock className="h-5 w-32 mb-4" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <SkeletonBlock key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    </div>
    {/* Recent tweets */}
    <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
      <SkeletonBlock className="h-5 w-40 mb-4" />
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-start space-x-3 pb-4 border-b border-gray-100 last:border-0">
            <SkeletonBlock className="h-10 w-10 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-3/4" />
              <SkeletonBlock className="h-3 w-1/2" />
              <div className="flex space-x-4 pt-1">
                <SkeletonBlock className="h-3 w-12" />
                <SkeletonBlock className="h-3 w-12" />
                <SkeletonBlock className="h-3 w-12" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// History skeleton 
export const HistorySkeleton = () => (
  <div className="space-y-6">
    {/* Header */}
    <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
      <SkeletonBlock className="h-6 w-40 mb-2" />
      <SkeletonBlock className="h-4 w-64" />
    </div>
    {/* Filters */}
    <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
      <div className="flex flex-wrap gap-3">
        {[...Array(4)].map((_, i) => (
          <SkeletonBlock key={i} className="h-9 w-28 rounded-lg" />
        ))}
      </div>
    </div>
    {/* Tweet cards */}
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="bg-white rounded-lg p-5 border border-gray-200 shadow-sm">
          <div className="flex items-start space-x-3">
            <SkeletonBlock className="h-10 w-10 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="flex items-center space-x-2">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-3 w-16" />
              </div>
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="h-4 w-4/5" />
              <div className="flex space-x-6 pt-2">
                <SkeletonBlock className="h-3 w-14" />
                <SkeletonBlock className="h-3 w-14" />
                <SkeletonBlock className="h-3 w-14" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// Settings skeleton
export const SettingsSkeleton = () => (
  <div className="max-w-4xl mx-auto space-y-6">
    {/* Header */}
    <div>
      <SkeletonBlock className="h-7 w-32 mb-2" />
      <SkeletonBlock className="h-4 w-64" />
    </div>
    {/* Tabs */}
    <div className="flex space-x-1 bg-gray-100 rounded-lg p-1">
      {[...Array(3)].map((_, i) => (
        <SkeletonBlock key={i} className="h-9 flex-1 rounded-md" />
      ))}
    </div>
    {/* Twitter connection card */}
    <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
      <div className="flex items-center space-x-3 mb-4">
        <SkeletonBlock className="h-10 w-10 rounded-full" />
        <div className="space-y-2 flex-1">
          <SkeletonBlock className="h-5 w-48" />
          <SkeletonBlock className="h-3 w-72" />
        </div>
      </div>
      <SkeletonBlock className="h-12 w-full rounded-lg" />
    </div>
    {/* Settings sections */}
    {[...Array(2)].map((_, i) => (
      <div key={i} className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm space-y-4">
        <SkeletonBlock className="h-5 w-40" />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SkeletonBlock className="h-4 w-36" />
            <SkeletonBlock className="h-6 w-11 rounded-full" />
          </div>
          <div className="flex items-center justify-between">
            <SkeletonBlock className="h-4 w-44" />
            <SkeletonBlock className="h-6 w-11 rounded-full" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

// Page loader (used in Suspense fallback)
export const PageLoader = () => (
  <div className="flex items-center justify-center min-h-96">
    <div className="text-center space-y-3">
      <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-200 border-t-blue-600 mx-auto" />
      <p className="text-sm text-gray-500">Loading...</p>
    </div>
  </div>
);

export default SkeletonBlock;
