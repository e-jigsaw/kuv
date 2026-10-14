import { expect, test } from "vitest";
import { withKeyLock } from "./key-lock";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("same key calls run one at a time in order", async () => {
  const log: string[] = [];
  const mk = (name: string, ms: number) => () =>
    (async () => {
      log.push(`${name}:start`);
      await sleep(ms);
      log.push(`${name}:end`);
      return name;
    })();
  const results = await Promise.all([
    withKeyLock("k", mk("a", 30)),
    withKeyLock("k", mk("b", 1)),
    withKeyLock("k", mk("c", 1)),
  ]);
  expect(results).toEqual(["a", "b", "c"]);
  expect(log).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
});

test("different keys run concurrently", async () => {
  const log: string[] = [];
  const mk = (name: string, ms: number) => async () => {
    log.push(`${name}:start`);
    await sleep(ms);
    log.push(`${name}:end`);
  };
  await Promise.all([withKeyLock("x", mk("x", 30)), withKeyLock("y", mk("y", 1))]);
  expect(log.slice(0, 2)).toEqual(["x:start", "y:start"]);
  expect(log.indexOf("y:end")).toBeLessThan(log.indexOf("x:end"));
});

test("a rejected call does not block or poison the next one", async () => {
  const first = withKeyLock("e", async () => {
    await sleep(5);
    throw new Error("boom");
  });
  const second = withKeyLock("e", async () => "ok");
  await expect(first).rejects.toThrow("boom");
  await expect(second).resolves.toBe("ok");
  await expect(withKeyLock("e", async () => "again")).resolves.toBe("again");
});
