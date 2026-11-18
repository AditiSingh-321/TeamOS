import { extname } from "node:path";
import { registerHooks } from "node:module";

// Node's test runner loads the same TS modules used by Next.js.
// server-only is enforced by Next's bundler in the application.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export%20%7B%7D", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL("../src/" + specifier.slice(2) + ".ts", import.meta.url).href, context);
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !extname(specifier)) {
      try { return nextResolve(specifier + ".ts", context); } catch {}
    }
    return nextResolve(specifier, context);
  },
});
