import pool from '../config/database.js';
import {
  findMatchingTwitterConnectedAccounts,
  mapTwitterRegistryInputFromSourceRow,
  upsertTwitterConnectedAccount,
} from '../utils/twitterConnectedAccountRegistry.js';

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');

async function ensureSocialTableExists() {
  const { rows } = await pool.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'social_connected_accounts'
     LIMIT 1`
  );

  if (!rows.length) {
    throw new Error('Table social_connected_accounts does not exist in this database.');
  }
}

async function backfillPersonalAccounts(stats) {
  const { rows } = await pool.query(
    `SELECT *
     FROM twitter_auth
     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC`
  );

  stats.personalScanned = rows.length;

  for (const row of rows) {
    const registryInput = mapTwitterRegistryInputFromSourceRow('twitter_auth', row);
    if (!registryInput.userId || !registryInput.twitterUserId) {
      stats.personalSkipped += 1;
      continue;
    }

    const existingRows = await findMatchingTwitterConnectedAccounts(pool, {
      userId: registryInput.userId,
      twitterUserId: registryInput.twitterUserId,
      sourceTable: 'twitter_auth',
      sourceId: registryInput.sourceId,
    });

    if (!applyChanges) {
      if (existingRows.length > 0) stats.personalWouldUpdate += 1;
      else stats.personalWouldInsert += 1;
      if (existingRows.length > 1) stats.personalDuplicateRows += existingRows.length - 1;
      continue;
    }

    const result = await upsertTwitterConnectedAccount(pool, {
      ...registryInput,
      metadata: {
        backfilled_by: 'backfill-twitter-social-accounts',
      },
    });

    if (result.action === 'inserted') stats.personalInserted += 1;
    else if (result.action === 'updated') stats.personalUpdated += 1;
    stats.personalDeduped += result.dedupedCount;
  }
}

async function backfillTeamAccounts(stats) {
  const { rows } = await pool.query(
    `SELECT *
     FROM team_accounts
     WHERE active = true
     ORDER BY updated_at DESC NULLS LAST, id DESC`
  );

  stats.teamScanned = rows.length;

  for (const row of rows) {
    const registryInput = mapTwitterRegistryInputFromSourceRow('team_accounts', row);
    if (!registryInput.userId || !registryInput.teamId || !registryInput.twitterUserId) {
      stats.teamSkipped += 1;
      continue;
    }

    const existingRows = await findMatchingTwitterConnectedAccounts(pool, {
      userId: registryInput.userId,
      teamId: registryInput.teamId,
      twitterUserId: registryInput.twitterUserId,
      sourceTable: 'team_accounts',
      sourceId: registryInput.sourceId,
    });

    if (!applyChanges) {
      if (existingRows.length > 0) stats.teamWouldUpdate += 1;
      else stats.teamWouldInsert += 1;
      if (existingRows.length > 1) stats.teamDuplicateRows += existingRows.length - 1;
      continue;
    }

    const result = await upsertTwitterConnectedAccount(pool, {
      ...registryInput,
      metadata: {
        backfilled_by: 'backfill-twitter-social-accounts',
      },
    });

    if (result.action === 'inserted') stats.teamInserted += 1;
    else if (result.action === 'updated') stats.teamUpdated += 1;
    stats.teamDeduped += result.dedupedCount;
  }
}

async function main() {
  const stats = {
    personalScanned: 0,
    personalSkipped: 0,
    personalWouldInsert: 0,
    personalWouldUpdate: 0,
    personalInserted: 0,
    personalUpdated: 0,
    personalDuplicateRows: 0,
    personalDeduped: 0,
    teamScanned: 0,
    teamSkipped: 0,
    teamWouldInsert: 0,
    teamWouldUpdate: 0,
    teamInserted: 0,
    teamUpdated: 0,
    teamDuplicateRows: 0,
    teamDeduped: 0,
  };

  try {
    await ensureSocialTableExists();
    await backfillPersonalAccounts(stats);
    await backfillTeamAccounts(stats);

    console.log('[twitter-social-backfill] completed', {
      mode: applyChanges ? 'apply' : 'dry-run',
      stats,
    });
  } catch (error) {
    console.error('[twitter-social-backfill] failed:', error?.message || error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
