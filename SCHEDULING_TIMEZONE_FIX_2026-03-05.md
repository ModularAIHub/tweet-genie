
      company_id: '8',
      account_id: null,
      linkedin_user_id: 'NcKbsXDLrm',
      created_at: 2026-02-07T08:21:55.782Z
    }
  ]
}
[StrategyAnalysis] Organization follower endpoint failed {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  accountId: 'org:108765279',
  organizationId: '108765279',
  endpoint: 'https://api.linkedin.com/rest/networkSizes/urn%3Ali%3Aorganization%3A108765279?edgeType=CompanyFollowedByMember',
  status: 426,
  error: {
    status: 426,
    code: 'NONEXISTENT_VERSION',
    message: 'Requested version 20240501 is not active'
  }
}
[StrategyAnalysis] Organization follower endpoint failed {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  accountId: 'org:108765279',
  organizationId: '108765279',
  endpoint: 'https://api.linkedin.com/v2/networkSizes/urn:li:organization:108765279?edgeType=CompanyFollowedByMember',
  status: 400,
  error: {
    status: 400,
    code: 'ILLEGAL_ARGUMENT',
    message: 'Syntax exception in path variables'
  }
}
[StrategyAnalysis] Using personal/org account snapshot for strategy analysis {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  accountId: 'org:108765279',
  accountType: 'organization',
  displayName: 'SuiteGenie',
  username: 'org-108765279',
  followers: 0
}
[StrategyAnalysis] LinkedIn API fallback endpoint failed {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  authorUrn: 'urn:li:organization:108765279',
  endpoint: 'https://api.linkedin.com/rest/posts?q=author&author=urn%3Ali%3Aorganization%3A108765279&count=60&sortBy=LAST_MODIFIED',      
  status: 426,
  error: {
    status: 426,
    code: 'NONEXISTENT_VERSION',
    message: 'Requested version 20240501 is not active'
  }
}
[StrategyAnalysis] LinkedIn API fallback succeeded {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  authorUrn: 'urn:li:organization:108765279',
  endpoint: 'https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(urn%3Ali%3Aorganization%3A108765279)&count=60&sortBy=LAST_MODIFIED',
  count: 12
}
[StrategyAnalysis] Post summary and account snapshot ready {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  postCount: 12,
  sourceScope: 'organization(108765279):linkedin_api_fallback',      
  themeCount: 2,
  accountDisplayName: 'SuiteGenie',
  followers: 0
}
[Strategy] init-analysis completed {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  strategyId: '27336e7a-6ae8-4652-aaea-db8e769da120',
  analysisId: 'dae3ef1f-4f41-4705-ae99-494b15fefe7a',
  accountId: 'org:108765279',
  accountType: 'organization',
  tweetsAnalysed: 12,
  confidence: 'medium',
  topTopics: [ 'published', 'edited', 'growth' ],
  queueItems: 7,
  sourceScope: 'organization(108765279):linkedin_api_fallback'       
}

      company_id: '8',
      account_id: null,
      linkedin_user_id: 'NcKbsXDLrm',
      created_at: 2026-02-07T08:21:55.782Z
    }
  ]
}
[StrategyAnalysis] Organization follower endpoint failed {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  accountId: 'org:108765279',
  organizationId: '108765279',
  endpoint: 'https://api.linkedin.com/rest/networkSizes/urn%3Ali%3Aorganization%3A108765279?edgeType=CompanyFollowedByMember',
  status: 426,
  error: {
    status: 426,
    code: 'NONEXISTENT_VERSION',
    message: 'Requested version 20240501 is not active'
  }
}
[StrategyAnalysis] Organization follower endpoint failed {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  accountId: 'org:108765279',
  organizationId: '108765279',
  endpoint: 'https://api.linkedin.com/v2/networkSizes/urn:li:organization:108765279?edgeType=CompanyFollowedByMember',
  status: 400,
  error: {
    status: 400,
    code: 'ILLEGAL_ARGUMENT',
    message: 'Syntax exception in path variables'
  }
}
[StrategyAnalysis] Using personal/org account snapshot for strategy analysis {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  accountId: 'org:108765279',
  accountType: 'organization',
  displayName: 'SuiteGenie',
  username: 'org-108765279',
  followers: 0
}
[StrategyAnalysis] LinkedIn API fallback endpoint failed {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  authorUrn: 'urn:li:organization:108765279',
  endpoint: 'https://api.linkedin.com/rest/posts?q=author&author=urn%3Ali%3Aorganization%3A108765279&count=60&sortBy=LAST_MODIFIED',      
  status: 426,
  error: {
    status: 426,
    code: 'NONEXISTENT_VERSION',
    message: 'Requested version 20240501 is not active'
  }
}
[StrategyAnalysis] LinkedIn API fallback succeeded {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  authorUrn: 'urn:li:organization:108765279',
  endpoint: 'https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(urn%3Ali%3Aorganization%3A108765279)&count=60&sortBy=LAST_MODIFIED',
  count: 12
}
[StrategyAnalysis] Post summary and account snapshot ready {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  postCount: 12,
  sourceScope: 'organization(108765279):linkedin_api_fallback',      
  themeCount: 2,
  accountDisplayName: 'SuiteGenie',
  followers: 0
}
[Strategy] init-analysis completed {
  userId: '1abaa530-0e5c-48a5-90eb-7b0a06c2b5ce',
  strategyId: '27336e7a-6ae8-4652-aaea-db8e769da120',
  analysisId: 'dae3ef1f-4f41-4705-ae99-494b15fefe7a',
  accountId: 'org:108765279',
  accountType: 'organization',
  tweetsAnalysed: 12,
  confidence: 'medium',
  topTopics: [ 'published', 'edited', 'growth' ],
  queueItems: 7,
  sourceScope: 'organization(108765279):linkedin_api_fallback'       
}
