import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { FileAccessPolicyService } from './file-access-policy.service';

describe('FileAccessPolicyService', () => {
  const workspaceRoot = path.resolve('/tmp/rag-workspace');
  let service: FileAccessPolicyService;

  beforeEach(() => {
    service = new FileAccessPolicyService({
      get: (key: string) =>
        key === 'workspace.uploadDir'
          ? path.join(workspaceRoot, 'uploads')
          : undefined,
    } as ConfigService);
  });

  it('allows files inside the workspace root', () => {
    const decision = service.validate('uploads/doc.md');

    expect(decision).toEqual({
      allowed: true,
      normalizedPath: path.join(workspaceRoot, 'uploads/doc.md'),
    });
  });

  it('rejects path traversal outside the workspace root', () => {
    const decision = service.validate('../backend/.env');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('path is outside allowed workspace roots');
  });

  it('rejects sensitive path segments even inside allowed roots', () => {
    const decision = service.validate(
      path.join(workspaceRoot, '.history/.env'),
    );

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('path contains denied segment: .history');
  });

  it('throws ForbiddenException when asserting a denied path', () => {
    expect(() =>
      service.assertAllowed('/tmp/rag-workspace/.git/config'),
    ).toThrow('path contains denied segment: .git');
  });
});
