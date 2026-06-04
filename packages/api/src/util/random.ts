import { randomInt } from "node:crypto";

const CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// apikey の key 用ランダム英数字（旧 archive/shared/src/util/random.ts の移植。
// 旧版の randomInt(0, len - 1) は最終文字が出ないオフバイワンだったため上限排他に修正）
export function generateRandomString(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CHARACTERS[randomInt(0, CHARACTERS.length)];
  }
  return out;
}
