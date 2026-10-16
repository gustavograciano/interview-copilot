import { defineConfig } from 'vite';

// Externalize Electron + the entire nut-js stack. Bundling nut-js statically
// resolves its `require("@nut-tree-fork/libnut-${process.platform}")` dispatch
// into THREE eager top-level requires, which causes Windows to try to dlopen
// the foreign-platform binaries → ERROR_BAD_EXE_FORMAT (193).
// Leaving them external keeps the runtime conditional intact.
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron',
        '@nut-tree-fork/nut-js',
        '@nut-tree-fork/libnut',
        '@nut-tree-fork/libnut-win32',
        '@nut-tree-fork/libnut-darwin',
        '@nut-tree-fork/libnut-linux',
        'libnut',
        'bindings',
      ],
    },
  },
});
