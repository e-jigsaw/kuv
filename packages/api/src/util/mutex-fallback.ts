// 同一 key の生成処理（fallBackFunc）を 1 回に抑える排他ユーティリティ。
// mainFunc（cache lookup）が値を返せばそれを返す。null/undefined なら fallBackFunc を実行。
// 別呼び出しが同 key の fallback を実行中なら、その完了を待って mainFunc を再試行する。
// 旧 archive/backend/src/util/mutex-fallback.ts の移植（in-process 排他。マルチプロセスでは効かない）。
const fallBackMap: Record<string, Promise<unknown>> = {};

export async function mutexFallBack<O>(
  key: string,
  mainFunc: () => Promise<O | null | undefined>,
  fallBackFunc: () => Promise<O>,
): Promise<O> {
  const tried = await mainFunc();
  if (tried !== undefined && tried !== null) return tried;

  // 同 key の fallback が走っていれば待って再試行
  if (fallBackMap[key] !== undefined) {
    await fallBackMap[key];
    return mutexFallBack(key, mainFunc, fallBackFunc);
  }

  // 自分が fallback を開始する
  const fallBackPromise = fallBackFunc();
  fallBackMap[key] = fallBackPromise;
  fallBackPromise.finally(() => {
    delete fallBackMap[key];
  });

  return fallBackPromise;
}
