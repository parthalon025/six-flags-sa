import { greet } from "./lib/impl";

/** Public entry point — callers and tests import this, not `lib/`. */
export function hello(name: string): string {
  return greet(name);
}
