import React from 'react';
import PropTypes from 'prop-types';

const TwitterAccountInfo = ({ twitterAccounts }) => {
  if (!twitterAccounts || twitterAccounts.length === 0) {
    return <div className="p-4 bg-gray-100 rounded">No Twitter accounts connected.</div>;
  }

  return (
    <div className="p-4 bg-white rounded shadow">
      <h3 className="text-lg font-semibold mb-2">Connected Twitter Accounts</h3>
      <ul className="space-y-2">
        {twitterAccounts.map(account => (
          <li key={account.id} className="flex items-center gap-2">
            <span className="font-medium">@{account.username}</span>
            {/* Add more account info as needed */}
          </li>
        ))}
      </ul>
    </div>
  );
};

TwitterAccountInfo.propTypes = {
  twitterAccounts: PropTypes.array,
};

export default TwitterAccountInfo;
