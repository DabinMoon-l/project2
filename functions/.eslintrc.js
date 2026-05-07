module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*",
    ".eslintrc.js",
    "src/**/*.test.ts",
  ],
  plugins: [
    "@typescript-eslint",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "quotes": ["error", "double"],
    "indent": ["error", 2],
    // destructuring에서 일부만 재할당되는 경우 let 허용 (workerProcessJob 등 패턴)
    "prefer-const": ["error", { "destructuring": "all" }],
  },
};
