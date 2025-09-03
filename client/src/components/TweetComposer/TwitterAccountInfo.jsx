import React from 'react';

const TwitterAccountInfo = ({ twitterAccounts }) => {
  if (!twitterAccounts || twitterAccounts.length === 0) return null;

  return (
    <div className="card mb-6">
      <div className="flex items-center space-x-3">
        <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
          <span className="text-blue-600 font-medium text-sm">
            {twitterAccounts[0].display_name?.[0]?.toUpperCase()}
          </span>
        </div>
        <div>
          <h3 className="font-medium text-gray-900">
            Posting as @{twitterAccounts[0].username}
          </h3>
          <p className="text-sm text-gray-600">
            {twitterAccounts[0].display_name}
          </p>
        </div>
      </div>
    </div>
  );
};

export default TwitterAccountInfo;
