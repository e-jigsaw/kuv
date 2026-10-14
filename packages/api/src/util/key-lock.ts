// key ごとの in-process 直列化ロック。同じ key の fn は呼び出し順に 1 つずつ実行される。
// 別 key は並行に走る。マルチプロセスでは効かない（api は単一プロセス前提）。
const tails = new Map<string, Promise<unknown>>();

export function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  // 前の呼び出しが失敗しても次は実行する（エラーは各呼び出し側にだけ返す）
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  // 自分が最後尾のままなら idle なので map から外す
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
