// TUTOR MOBILE HARNESS — stub for `@/convex/_generated/api`.
//
// Any property chain resolves to a leaf object carrying the accumulated
// path ("ai.getMessages"), which stub-convex-react matches against the
// fixture table. Typed `any` so FunctionReturnType<typeof api.x.y> in
// AppBootstrap keeps compiling unchanged.

type StubLeaf = { __path: string };

function makeApi(path: string[]): StubLeaf {
  return new Proxy({ __path: path.join(".") } as StubLeaf, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      if (typeof prop === "symbol") return undefined;
      return makeApi([...path, prop]);
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: any = makeApi([]);
