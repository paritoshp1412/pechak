import { defineConfig } from "vite";

// Pechak is deployed as a static GitHub Pages *project* site (served from a
// "/pechak/" subpath, not the domain root), and the build previously used
// Vite's default `base: "/"`. That baked root-absolute asset URLs
// (e.g. "/assets/index-....js") into dist/index.html, which 404 once the
// page is actually served from "/pechak/..." -- the module script never
// loads, so nothing in the app (including the onboarding wizard) ever runs.
// A relative base makes the build work unmodified at any subpath (root
// domain, GitHub Pages project path, or a future custom domain) without
// hardcoding a specific deploy path here.
export default defineConfig({
  base: "./",
});
