import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    ignores: [
      // Flat-config ignores resolve against this file's directory, so a bare
      // '.next/**' only ever matched a root-level build. The workspace builds
      // into apps/party-tracker/.next, which `npm run lint` then linted the
      // moment anyone had built — CI never noticed because its tree is fresh.
      '**/.next/**',
      'node_modules/**',
      '**/out/**',
      'apps/party-tracker/public/sw.js',
      '.gitnexus/**',
      '.claude/**',
      'packages/**',
      'test/**',
    ],
  },
  ...nextCoreWebVitals.map((entry) => ({
    ...entry,
    files: entry.files ?? ['apps/party-tracker/**/*.{js,jsx,mjs}'],
  })),
  {
    files: ['apps/party-tracker/app/layout.js'],
    rules: { '@next/next/no-page-custom-font': 'off' },
  },
  {
    files: ['apps/party-tracker/**/*.{js,jsx}'],
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
];

export default config;
