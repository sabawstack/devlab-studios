import { defineConfig } from 'vitest/config'

export default defineConfig({
  // React components are tested with renderToStaticMarkup (e.g. NodeMascot).
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    // `scripts/**` is included deliberately. The seed generator emits SQL that
    // only fails when it is APPLIED - an `INSERT OR IGNORE` hides a CHECK
    // violation - so its test has to live beside it and actually run. A test
    // file outside these globs is silently never executed, which is worse than
    // not writing it.
    include: ['src/**/*.test.js', 'src/**/*.test.jsx', 'src/**/*.test.ts', 'scripts/**/*.test.js'],
  },
})
