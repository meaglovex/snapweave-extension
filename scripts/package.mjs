import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const distDir = resolve("dist");
const zipPath = join(distDir, "extension.zip");
const checksumsPath = join(distDir, "checksums.txt");

const listFiles = (directory, prefix = "") => {
  const entries = readdirSync(directory).sort();
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry);
    const relativePath = prefix ? join(prefix, entry) : entry;
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...listFiles(fullPath, relativePath));
      continue;
    }

    if (relativePath === "extension.zip" || relativePath === "checksums.txt") {
      continue;
    }

    files.push(relativePath);
  }

  return files;
};

const files = listFiles(distDir);
execFileSync("zip", ["-r", zipPath, ...files], {
  cwd: distDir,
  stdio: "inherit"
});

const zipBuffer = readFileSync(zipPath);
const checksum = createHash("sha256").update(zipBuffer).digest("hex");
writeFileSync(checksumsPath, `${checksum}  ${relative(distDir, zipPath)}\n`);
