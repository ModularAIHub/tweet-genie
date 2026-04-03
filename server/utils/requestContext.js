import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export const captureRequestContext = (req, _res, next) => {
  storage.run(
    {
      authorization: req.headers['authorization'] || null,
      agencyToken: req.headers['x-agency-token'] || null,
      agencyWorkspaceId: req.headers['x-agency-workspace-id'] || null,
      agencyTool: req.headers['x-agency-tool'] || null,
      agencyTarget: req.headers['x-agency-target'] || null,
      teamId: req.headers['x-team-id'] || null,
      agencyWorkspace: req.agencyWorkspace || null,
    },
    next
  );
};

export const getRequestContext = () => storage.getStore() || {};
