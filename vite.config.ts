import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: ["site/**", ".work/**", "archive/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["site/**", ".work/**", "archive/**"],
    printWidth: 110,
  },
  test: {
    include: [],
    includeSource: ["src/lib/**/*.ts"],
  },
});
