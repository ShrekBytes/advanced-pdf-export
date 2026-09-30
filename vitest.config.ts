import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

// The `obsidian` package ships type definitions only — it has no runtime entry
// point, so Vite cannot resolve it and any test importing a module that pulls it
// in fails before a single assertion runs. Point the bare specifier at a stub so
// those modules stay unit-testable; typechecking still reads the real .d.ts,
// because this alias only applies to the test runner.
export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL("./src/__mocks__/obsidian.ts", import.meta.url)),
    },
  },
});
