import { AsyncLocalStorage } from 'node:async_hooks';

const requestBearer = new AsyncLocalStorage<string>();

export function withHttpBearer<T>(token: string, callback: () => T): T {
  return requestBearer.run(token, callback);
}

export function currentHttpBearer(): string | undefined {
  return requestBearer.getStore();
}
