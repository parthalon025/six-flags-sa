import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  // sw.js is a service worker, not app code — it runs in its own global scope.
  { ignores: ['.next/**', 'node_modules/**', 'out/**', 'public/sw.js'] },
  ...compat.extends('next/core-web-vitals'),
  {
    // no-page-custom-font is a Pages Router rule looking for pages/_document.js.
    // The font link lives in the App Router root layout, so it already applies
    // to every page and the warning is a false positive here.
    files: ['app/layout.js'],
    rules: { '@next/next/no-page-custom-font': 'off' },
  },
];

export default config;
