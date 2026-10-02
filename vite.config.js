import { defineConfig } from 'vite';

// base './' keeps every asset URL relative, so the build works from any sub path
// (for example https://bop-del.github.io/chess-3d/) as well as from a domain root.
export default defineConfig({
  base: './',
  build: { target: 'safari15', chunkSizeWarningLimit: 1400 },
});
