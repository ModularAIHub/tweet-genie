import { buildTeamAccountFilter, resolveTeamAccountScope } from './teamAccountScope.js';
import { fetchLatestPersonalTwitterAuth, fetchPersonalTwitterAuthById } from './personalTwitterAuth.js';

export const TWITTER_RECONNECT_REQUIRED_CODE = 'TWITTER_RECONNECT_REQUIRED';

export const buildReconnectRequiredPayload = (extra = {}) => ({
  error: 'Twitter account not connected. Please reconnect your Twitter account.',
  code: TWITTER_RECONNECT_REQUIRED_CODE,
  reconnect: true,
  ...extra,
});

const qualify = (alias, column) => (alias ? `${alias}.${column}` : column);

export const resolveTwitterScope = async (dbPool, { userId, selectedAccountId, teamId = null }) => {
  const normalizedSelectedAccountId =
    selectedAccountId === undefined || selectedAccountId === null || String(selectedAccountId).trim() === ''
      ? null
      : String(selectedAccountId).trim();
  const normalizedTeamId =
    teamId === undefined || teamId === null || String(teamId).trim() === ''
      ? null
      : String(teamId).trim();

  // Team scope is opt-in by request context (x-team-id), never by local selected account alone.
  const teamScope = normalizedSelectedAccountId && normalizedTeamId
    ? await resolveTeamAccountScope(dbPool, userId, normalizedSelectedAccountId)
    : null;

  if (teamScope) {
    return {
      mode: 'team',
      connected: true,
      userId,
      selectedAccountId: normalizedSelectedAccountId,
      effectiveAccountId: teamScope.selectedAccountId || null,
      twitterUserId: teamScope.twitterUserId || null,
      teamScope,
      ignoredSelectedAccountId: false,
    };
  }

  let personal = null;
  let ignoredSelectedAccountId = false;

  if (normalizedSelectedAccountId) {
    personal = await fetchPersonalTwitterAuthById(dbPool, userId, normalizedSelectedAccountId, {
      columns: 'id, twitter_user_id, twitter_username',
    });
    ignoredSelectedAccountId = !personal;
  }

  if (!personal) {
    personal = await fetchLatestPersonalTwitterAuth(dbPool, userId, {
      columns: 'id, twitter_user_id, twitter_username',
    });
  }

  if (!personal) {
    return {
      mode: 'personal',
      connected: false,
      userId,
      selectedAccountId: normalizedSelectedAccountId,
      effectiveAccountId: null,
      twitterUserId: null,
      twitterUsername: null,
      teamScope: null,
      ignoredSelectedAccountId: !!normalizedSelectedAccountId,
    };
  }

  return {
    mode: 'personal',
    connected: true,
    userId,
    selectedAccountId: normalizedSelectedAccountId,
    effectiveAccountId: personal.id ? String(personal.id) : null,
    twitterUserId: personal.twitter_user_id ? String(personal.twitter_user_id) : null,
    twitterUsername: personal.twitter_username || null,
    teamScope: null,
    ignoredSelectedAccountId,
  };
};

export const buildTwitterScopeFilter = ({
  scope,
  alias = '',
  startIndex = 1,
  includeLegacyPersonalFallback = true,
  includeTeamOrphanFallback = true,
  orphanUserId = null,
}) => {
  if (!scope) {
    return { clause: '', params: [], nextIndex: startIndex };
  }

  if (scope.mode === 'team' && scope.teamScope) {
    return buildTeamAccountFilter({
      scope: scope.teamScope,
      alias,
      startIndex,
      includeOrphanFallback: includeTeamOrphanFallback,
      orphanUserId: orphanUserId || scope.userId,
    });
  }

  if (!scope.connected || !scope.twitterUserId) {
    return { clause: ' AND 1 = 0', params: [], nextIndex: startIndex };
  }

  const params = [];
  const conditions = [];
  const authorIdIndex = startIndex + params.length;
  params.push(scope.twitterUserId);
  conditions.push(`${qualify(alias, 'author_id')} = $${authorIdIndex}`);

  if (includeLegacyPersonalFallback) {
    const fallbackUserIdIndex = startIndex + params.length;
    params.push(scope.userId);
    conditions.push(`(${qualify(alias, 'author_id')} IS NULL AND ${qualify(alias, 'user_id')} = $${fallbackUserIdIndex})`);
  }

  return {
    clause: ` AND (${qualify(alias, 'account_id')} IS NULL OR ${qualify(alias, 'account_id')}::text = '0') AND (${conditions.join(' OR ')})`,
    params,
    nextIndex: startIndex + params.length,
  };
};
