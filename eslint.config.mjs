import eslint from "@eslint/js";
import stylisticJs from "@stylistic/eslint-plugin-ts";
import pluginImport from "eslint-plugin-import";
import perfectionist from "eslint-plugin-perfectionist";
import tseslint from "typescript-eslint";

const consistentTypeImports = [
  "error",
  {
    fixStyle: "inline-type-imports",
    prefer: "type-imports",
  },
];

const sortNamedImports = ["error", { groupKind: "types-first" }];
const sortNamedExports = ["error", { groupKind: "types-first" }];

const noRestrictedSyntax = [
  "error",
  ...[
    "TSInterfaceDeclaration",
    "TSTypeAliasDeclaration",
    "VariableDeclaration",
  ].map((name) => ({
    // Disallow "export const foo = " but allow "export { foo }"
    selector: `ExportNamedDeclaration[declaration.type='${name}']`,
    message: "Prefer named exports",
  })),
];

const consistentTypeExports = [
  "error",
  {
    fixMixedExportsWithInlineTypeSpecifier: true,
  },
];

const paddingLineBetweenStatements = [
  "error",
  { blankLine: "always", next: "return", prev: "*" },
]
  .concat(
    [
      "multiline-block-like",
      "multiline-expression",
      "multiline-const",
      "const",
      "type",
      "interface",
      "if",
    ]
      .map((item) => [
        { blankLine: "always", next: "*", prev: item },
        { blankLine: "always", next: item, prev: "*" },
      ])
      .flat()
  )
  .concat([
    {
      blankLine: "any",
      next: ["singleline-const"],
      prev: ["singleline-const"],
    },
  ]);

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      import: pluginImport,
      perfectionist,
      stylistic: stylisticJs,
      ts: tseslint,
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": consistentTypeImports,
      "@typescript-eslint/consistent-type-exports": consistentTypeExports,
      "arrow-body-style": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "import/group-exports": "error",
      "import/no-default-export": "error",
      "import/no-duplicates": "error",
      "no-restricted-syntax": noRestrictedSyntax,
      "perfectionist/sort-array-includes": "error",
      "perfectionist/sort-classes": "error",
      "perfectionist/sort-enums": "error",
      "perfectionist/sort-exports": "error",
      "perfectionist/sort-imports": "error",
      "perfectionist/sort-interfaces": "error",
      "perfectionist/sort-intersection-types": "error",
      "perfectionist/sort-jsx-props": "error",
      "perfectionist/sort-maps": "error",
      "perfectionist/sort-named-exports": sortNamedExports,
      "perfectionist/sort-named-imports": sortNamedImports,
      "perfectionist/sort-object-types": "error",
      "perfectionist/sort-objects": "error",
      "perfectionist/sort-sets": "error",
      "perfectionist/sort-switch-case": "error",
      "perfectionist/sort-union-types": "error",
      "perfectionist/sort-variable-declarations": "error",
      "stylistic/padding-line-between-statements": paddingLineBetweenStatements,
    },
  },
];
