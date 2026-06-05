import vikeReact from "vike-react/config";
import type { Config } from "vike/types";

export default {
  ssr: false,
  // 動的ルート（/image/@id）は prerender 不能なので partial にする。
  // prerender されないページは Caddy / vite の SPA fallback で index.html が配信される
  prerender: { partial: true },
  extends: vikeReact,
} satisfies Config;
