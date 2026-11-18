import { extname } from "node:path";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !extname(specifier)) {
    try { return nextResolve(specifier + ".ts", context); } catch {}
  }
  return nextResolve(specifier, context);
} });
