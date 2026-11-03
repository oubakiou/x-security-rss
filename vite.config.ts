import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: ["site/**", ".work/**", ".temp/**", "archive/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["site/**", ".work/**", ".temp/**", "archive/**"],
    printWidth: 110,
  },
  test: {
    include: ["scripts/**/*.test.ts"],
    includeSource: ["src/lib/**/*.ts"],
  },
});
