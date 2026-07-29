import { defineConfig, type Plugin } from "vite";

// Our core uses NodeNext-style ".js" import specifiers (required for the Node
// CLI). This tiny plugin resolves those to the real ".ts" sources so the same
// code runs unmodified in the browser build.
function tsJsResolve(): Plugin {
  return {
    name: "ts-js-resolve",
    enforce: "pre",
    async resolveId(source, importer) {
      if (importer && /\.js$/.test(source) && (source.startsWith(".") || source.startsWith("/"))) {
        const asTs = source.replace(/\.js$/, ".ts");
        const r = await this.resolve(asTs, importer, { skipSelf: true });
        if (r) return r;
      }
      return null;
    },
  };
}

export default defineConfig({
  root: ".",
  base: "./",
  plugins: [tsJsResolve()],
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
});
