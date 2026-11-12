import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Script suites start a real T3 server per test, which takes seconds.
    testTimeout: 60_000,
  },
});
