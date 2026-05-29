import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Force Vite to pre-bundle these CJS packages into proper ESM.
    // Without this, dynamic import() of CJS packages can produce an object
    // where module.exports lands on `default` instead of being hoisted as
    // named exports — causing "FaceMesh is not a constructor".
    include: [
      "@mediapipe/face_mesh",
      "@tensorflow/tfjs",
      "@tensorflow-models/coco-ssd",
    ],
    esbuildOptions: {
      // Needed so esbuild correctly handles CommonJS modules
      mainFields: ["main"],
    },
  },
  build: {
    commonjsOptions: {
      // Ensure Rollup transforms CJS to ESM during production build
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
});
