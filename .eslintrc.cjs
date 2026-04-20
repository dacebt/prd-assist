module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["./tsconfig.json", "./apps/*/tsconfig.json", "./packages/*/tsconfig.json"],
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/require-await": "error",
    "@typescript-eslint/return-await": ["error", "always"],
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-unnecessary-condition": "error",
    "@typescript-eslint/switch-exhaustiveness-check": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/prefer-nullish-coalescing": "error",
    "@typescript-eslint/prefer-optional-chain": "error",
    eqeqeq: ["error", "always"],
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
    "max-lines-per-function": [
      "error",
      { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true },
    ],
    complexity: ["error", 10],
    "@typescript-eslint/consistent-type-assertions": [
      "error",
      { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
    ],
    "@typescript-eslint/no-unsafe-argument": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",
  },
  overrides: [
    {
      files: ["apps/web/**/*.{ts,tsx}"],
      plugins: ["react-hooks"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
    {
      files: ["scripts/**/*.ts", "**/*.test.ts", "**/*.test.tsx"],
      rules: {
        "no-console": "off",
        "max-lines-per-function": "off",
      },
    },
  ],
};
