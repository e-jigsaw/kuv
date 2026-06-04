import { expect, test } from "vitest";
import { mutexFallBack } from "./mutex-fallback";

test("returns the main value without calling fallback when main hits", async () => {
  let fallbackCalls = 0;
  const r = await mutexFallBack(
    "k1",
    async () => "cached",
    async () => {
      fallbackCalls++;
      return "generated";
    },
  );
  expect(r).toBe("cached");
  expect(fallbackCalls).toBe(0);
});

test("runs fallback when main misses and returns its value", async () => {
  let fallbackCalls = 0;
  const r = await mutexFallBack(
    "k2",
    async () => null,
    async () => {
      fallbackCalls++;
      return "generated";
    },
  );
  expect(r).toBe("generated");
  expect(fallbackCalls).toBe(1);
});

test("concurrent calls with the same key run fallback only once", async () => {
  let fallbackCalls = 0;
  const store = new Map<string, string>();

  const job = () =>
    mutexFallBack(
      "k3",
      async () => store.get("v") ?? null,
      async () => {
        fallbackCalls++;
        // 生成に時間がかかる想定
        await new Promise((r) => setTimeout(r, 50));
        store.set("v", "generated");
        return "generated";
      },
    );

  const results = await Promise.all([job(), job(), job(), job()]);
  expect(results).toEqual(["generated", "generated", "generated", "generated"]);
  expect(fallbackCalls).toBe(1);
});

test("different keys do not block each other", async () => {
  let calls = 0;
  const job = (key: string) =>
    mutexFallBack(
      key,
      async () => null,
      async () => {
        calls++;
        return key;
      },
    );
  const [a, b] = await Promise.all([job("ka"), job("kb")]);
  expect(a).toBe("ka");
  expect(b).toBe("kb");
  expect(calls).toBe(2);
});
