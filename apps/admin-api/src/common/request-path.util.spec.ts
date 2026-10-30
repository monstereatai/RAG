import { redactWorkspacePreviewTicketFromPath } from './request-path.util';

describe('redactWorkspacePreviewTicketFromPath', () => {
  it('redacts preview tickets and omits their query string', () => {
    expect(
      redactWorkspacePreviewTicketFromPath(
        '/api/admin/agent-ops/workflows/thread-1/workspace/preview/secret-ticket/assets/main.js?token=secret',
      ),
    ).toBe(
      '/api/admin/agent-ops/workflows/thread-1/workspace/preview/[redacted]/assets/main.js',
    );
  });

  it('leaves unrelated request paths unchanged', () => {
    expect(redactWorkspacePreviewTicketFromPath('/api/admin/agent-ops/workflows/thread-1'))
      .toBe('/api/admin/agent-ops/workflows/thread-1');
  });
});
