declare module "cloudflare:workers" {
  export class DurableObject<Env = unknown> {
    constructor(ctx: unknown, env: Env);
    protected ctx: {
      storage: {
        get<T = unknown>(key: string): Promise<T | undefined>;
        put<T = unknown>(key: string, value: T): Promise<void>;
      };
      blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
      waitUntil?(promise: Promise<unknown>): void;
    };
    protected env: Env;
  }
}
