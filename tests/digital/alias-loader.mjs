import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Node's test runner needs the same @/ mapping and TSX transformation as Next.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    const base = specifier.startsWith("@/") ? new URL(`../../${specifier.slice(2)}`, import.meta.url)
      : specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL) : null;
    if (base) {
      const url = [".ts", ".tsx"].map((extension) => new URL(base.href + extension))
        .find((candidate) => existsSync(fileURLToPath(candidate)));
      if (url) return nextResolve(url.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) return { format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText };
    return nextLoad(url, context);
  },
});
