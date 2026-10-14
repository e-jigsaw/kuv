import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startTestS3 } from "../test/s3";
import {
  createMemoryBlobStore,
  createS3BlobStore,
  derivativeBlobKey,
  fileKey,
  type BlobStore,
} from "./blob-store";

test("key layout", () => {
  expect(fileKey("abc", "master")).toBe("abc/master");
  expect(fileKey("abc", "original")).toBe("abc/original");
  expect(derivativeBlobKey("abc", "k1")).toBe("abc/d/k1");
});

// 同じ契約を memory / S3 の両実装に流す
function contract(name: string, setup: () => Promise<{ store: BlobStore; teardown: () => Promise<void> }>) {
  describe(name, () => {
    let store: BlobStore;
    let teardown: () => Promise<void>;
    beforeAll(async () => {
      ({ store, teardown } = await setup());
    });
    afterAll(async () => {
      await teardown();
    });

    test("put then get returns the same bytes", async () => {
      await store.put("a/master", Buffer.from([1, 2, 3]), "image/png");
      const got = await store.get("a/master");
      expect(got).not.toBe(null);
      expect(Buffer.compare(got!, Buffer.from([1, 2, 3]))).toBe(0);
    });

    test("head returns the size", async () => {
      await store.put("b/master", Buffer.alloc(1234, 7), "image/png");
      expect(await store.head("b/master")).toEqual({ size: 1234 });
    });

    test("get and head return null for a missing key", async () => {
      expect(await store.get("nope/master")).toBe(null);
      expect(await store.head("nope/master")).toBe(null);
    });

    test("put overwrites an existing key", async () => {
      await store.put("c/master", Buffer.from([1]), "image/png");
      await store.put("c/master", Buffer.from([2, 2]), "image/png");
      expect(await store.head("c/master")).toEqual({ size: 2 });
    });

    test("delete removes keys and ignores missing ones", async () => {
      await store.put("d/master", Buffer.from([1]), "image/png");
      await store.put("d/d/k", Buffer.from([1]), "image/webp");
      await store.delete(["d/master", "d/d/k", "d/original"]);
      expect(await store.head("d/master")).toBe(null);
      expect(await store.head("d/d/k")).toBe(null);
    });

    test("delete with an empty list is a no-op", async () => {
      await store.delete([]);
    });
  });
}

contract("memory", async () => ({ store: createMemoryBlobStore(), teardown: async () => {} }));

contract("s3 (seaweedfs)", async () => {
  const s3 = await startTestS3();
  return { store: createS3BlobStore(s3.config), teardown: s3.teardown };
});
