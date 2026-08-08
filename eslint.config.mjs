// eslint-config-next ships flat config natively from 16, so it is spread in
// directly. Routing it through FlatCompat — which is what the eslintrc-era
// shape needed — now throws on the plugin object's own self-reference.
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  // sw.js is a service worker, not app code — it runs in its own global scope.
  { ignores: ['.next/**', 'node_modules/**', 'out/**', 'public/sw.js'] },
  ...nextCoreWebVitals,
  {
    /**
     * The React Compiler rules arrived with eslint-config-next 16 and report 28
     * findings in UI written well before them — effects that set state, reads of
     * Date.now() during render, a couple of mutated props and refs. Every one of
     * them is a real observation and none of them is a deployment concern, so
     * they are warnings here rather than errors: loud enough to be worked
     * through deliberately, quiet enough that they do not gate a build on
     * unrelated work. Promote them back to `error` as the list is cleared.
     */
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  {
    // no-page-custom-font is a Pages Router rule looking for pages/_document.js.
    // The font link lives in the App Router root layout, so it already applies
    // to every page and the warning is a false positive here.
    files: ['app/layout.js'],
    rules: { '@next/next/no-page-custom-font': 'off' },
  },
];

export default config;
