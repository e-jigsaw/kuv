import vikeReact from "vike-react/config";
import type { Config } from "vike/types";

export default {
  ssr: false,
  prerender: true,
  extends: vikeReact,
} satisfies Config;
