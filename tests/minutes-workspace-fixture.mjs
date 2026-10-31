import { isMinutesWorkspace } from '../src/minutes-workspace.mjs';

export const emptyWorkspace = () => ({ version: 1, meeting: null, tasks: [], selectedTaskId: null, experts: [], activeExpert: '', records: [], discussion: [], question: '', search: '', tab: 'tasks', person: '', minutes: '', filename: '' });

export async function mockWorkspaces(page) {
  const workspaces = new Map();
  await page.route('**/api/minutes/workspaces/*', async route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const current = workspaces.get(id) || { workspace: null, revision: 0 };
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      if (!isMinutesWorkspace(body.workspace)) return route.fulfill({ status: 400, json: { error: 'Invalid workspace' } });
      if (body.revision !== current.revision) return route.fulfill({ status: 409, json: { error: 'Workspace conflict' } });
      workspaces.set(id, { workspace: body.workspace, revision: body.revision + 1 });
      return route.fulfill({ json: { ok: true, revision: body.revision + 1 } });
    }
    return route.fulfill({ json: current });
  });
  return workspaces;
}
