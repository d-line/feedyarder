import { execFile } from "node:child_process";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptsDirPath = path.dirname(scriptFilePath);
const packageDirPath = path.resolve(scriptsDirPath, "..");
const openApiPath = path.resolve(packageDirPath, "openapi/feedyarder.openapi.yaml");
const tempOutputPath = path.resolve(packageDirPath, "src/.api.generated.tmp.ts");
const generatedOutputPath = path.resolve(packageDirPath, "src/api.generated.ts");

await access(openApiPath);

await execFileAsync(
  "openapi-zod-client",
  [
    openApiPath,
    "-o",
    tempOutputPath,
    "--export-schemas",
    "--export-types",
    "--strict-objects",
    "--group-strategy",
    "none"
  ],
  {
    cwd: packageDirPath
  }
);

const rawGenerated = await readFile(tempOutputPath, "utf8");

const zImportMarker = 'import { z } from "zod";';
const zImportIndex = rawGenerated.indexOf(zImportMarker);
const schemasExportIndex = rawGenerated.indexOf("\nexport const schemas =");

if (zImportIndex < 0 || schemasExportIndex < 0) {
  throw new Error("Failed to parse openapi-zod-client output.");
}

const body = rawGenerated
  .slice(zImportIndex + zImportMarker.length, schemasExportIndex)
  .trim();
const schemasExportMatch = rawGenerated
  .slice(schemasExportIndex)
  .match(/^export const schemas = \{[\s\S]*?\n\};/m);

if (!schemasExportMatch) {
  throw new Error("Failed to extract schemas export from generated output.");
}

const schemasExport = schemasExportMatch[0].trim();

const generatedFile = [
  "/* eslint-disable */",
  "// AUTO-GENERATED FILE. DO NOT EDIT.",
  '// Source: openapi/feedyarder.openapi.yaml via `npm run generate:api -w @feedyarder/contracts`',
  "",
  'import { z } from "zod";',
  "",
  body,
  "",
  schemasExport,
  ""
].join("\n");

await writeFile(generatedOutputPath, generatedFile, "utf8");
await rm(tempOutputPath, { force: true });
