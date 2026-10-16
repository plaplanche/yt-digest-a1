// Rewrites each $ref to another schema file as a tsType, writes the result to the second argument and
// prints the matching imports: the generated TypeScript then imports the type instead of copying it.
const fs = require("fs"), path = require("path");
const [file, out] = process.argv.slice(2);
const imports = [];
const walk = (v) => {
  if (Array.isArray(v)) return v.map(walk);
  if (v === null || typeof v !== "object") return v;
  if (typeof v.$ref === "string" && v.$ref.endsWith(".schema.json")) {
    const ref = path.join(path.dirname(file), v.$ref);
    const title = JSON.parse(fs.readFileSync(ref, "utf8")).title;
    imports.push(`import type { ${title} } from "./${path.basename(v.$ref, ".schema.json")}.js";`);
    return { tsType: title };
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
};
fs.writeFileSync(out, JSON.stringify(walk(JSON.parse(fs.readFileSync(file, "utf8")))));
console.log([...new Set(imports)].join("\n"));
