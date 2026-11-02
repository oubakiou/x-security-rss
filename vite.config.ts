import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: ["public/**", "data/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["public/**", "data/**"],
    printWidth: 110,
  },
  test: {
    include: [],
    includeSource: ["src/lib/**/*.ts"],
  },
});
