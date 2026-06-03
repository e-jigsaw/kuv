import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function fixture(name: string): Promise<Buffer> {
  return readFile(join(here, "fixtures", name));
}
