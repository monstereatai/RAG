import { ApiScopes, API_SCOPE_CODES } from './api-scopes.decorator';

describe('ApiScopes', () => {
  it('accepts only scopes registered for IAM authorization', () => {
    expect(() => ApiScopes('rag:chat', 'rag:documents')).not.toThrow();
    expect(API_SCOPE_CODES).toContain('rag:chat');
  });

  it('fails during startup when an endpoint declares an unregistered scope', () => {
    expect(() => ApiScopes('rag:unregistered')).toThrow(
      'Unregistered API scope(s): rag:unregistered',
    );
  });
});
