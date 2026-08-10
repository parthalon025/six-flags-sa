import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
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
