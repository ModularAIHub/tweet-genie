import React, { useEffect } from 'react';
import { getSuiteGenieProUpgradeUrl } from '../utils/upgradeUrl';

const Pricing = () => {
  const upgradeUrl = getSuiteGenieProUpgradeUrl();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.location.replace(upgradeUrl);
    }
  }, [upgradeUrl]);

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold text-gray-900">Redirecting to SuiteGenie Plans...</h1>
      <p className="mt-2 text-sm text-gray-600">
        If you are not redirected automatically, continue here.
      </p>
      <a href={upgradeUrl} className="btn btn-primary mt-4 inline-flex items-center">
        Open SuiteGenie Plans
      </a>
    </div>
  );
};

export default Pricing;
