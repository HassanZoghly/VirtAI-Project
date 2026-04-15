const path = require('path');

module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime",
    "plugin:react-hooks/recommended",
  ],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  rules: {
    "react/prop-types": "off",
    "react/react-in-jsx-scope": "off",
    "react/no-unknown-property": [
      "error",
      {
        ignore: ["position", "intensity", "castShadow", "object", "args", "rotation", "scale"],
      },
    ],
    "no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      },
    ],
    "no-console": [
      "warn",
      {
        allow: ["warn", "error"],
      },
    ],
    "prefer-const": "warn",
    "no-var": "error",
    eqeqeq: ["error", "always"],
    curly: ["error", "all"],
    "no-debugger": "warn",
  },
  ignorePatterns: ["dist", "node_modules", "*.config.js"],
  overrides: [
    {
      files: ["*.ts", "*.tsx"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
      extends: ["plugin:@typescript-eslint/recommended"],
      rules: {
        "no-unused-vars": "off",
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-unused-vars": [
          "warn",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
          },
        ],
      },
    },
  ],
};
