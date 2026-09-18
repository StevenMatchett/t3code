import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const matches = (values, target) =>
  !values ||
  (!values.includes(`!${target}`) &&
    (!values.some((value) => !value.startsWith("!")) || values.includes(target)));

export function matchesRuntimeTarget(manifest, target) {
  return (
    matches(manifest.os, target.platform) &&
    matches(manifest.cpu, target.arch) &&
    matches(manifest.libc, target.libc ?? "glibc")
  );
}

export async function resolvePackageDirectory(name, fromDirectory, stopDirectory) {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name))
    throw new Error("Invalid runtime package name");
  for (let directory = fromDirectory; ; directory = NodePath.dirname(directory)) {
    const candidate = NodePath.join(directory, "node_modules", name);
    try {
      await NodeFSP.access(NodePath.join(candidate, "package.json"));
      return await NodeFSP.realpath(candidate);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
    }
    if (directory === stopDirectory || NodePath.dirname(directory) === directory) break;
  }
  return undefined;
}

export async function stageRuntimePackages({ roots, destination, target }) {
  destination = NodePath.join(
    await NodeFSP.realpath(NodePath.dirname(destination)),
    NodePath.basename(destination),
  );
  const staged = new Map();
  const reserved = new Map(
    await Promise.all(
      roots.map(async (root) => [
        root.name,
        await resolvePackageDirectory(root.name, root.fromDirectory),
      ]),
    ),
  );
  const skipped = new Set();
  const outputRoot = NodePath.dirname(destination);
  async function visit(name, fromDirectory, optional = false, parentDirectory = outputRoot) {
    const source = await resolvePackageDirectory(name, fromDirectory);
    if (!source) {
      if (optional) {
        skipped.add(name);
        return;
      }
      throw new Error(`Missing runtime package ${name}`);
    }
    const manifest = JSON.parse(
      await NodeFSP.readFile(NodePath.join(source, "package.json"), "utf8"),
    );
    if (!matchesRuntimeTarget(manifest, target)) {
      if (optional) {
        skipped.add(name);
        return;
      }
      throw new Error(`Runtime package ${name} does not support ${target.platform}-${target.arch}`);
    }
    const resolved = await resolvePackageDirectory(name, parentDirectory, outputRoot);
    if (resolved && staged.get(resolved)?.source === source) return;
    const hoisted = NodePath.join(destination, name);
    const canHoist = !staged.has(hoisted) && (!reserved.has(name) || reserved.get(name) === source);
    const packageDestination = canHoist
      ? hoisted
      : NodePath.join(parentDirectory, "node_modules", name);
    if (staged.has(packageDestination)) throw new Error(`Conflicting runtime roots for ${name}`);
    if (staged.size >= 500) throw new Error("Runtime dependency graph exceeds the artifact limit");
    staged.set(packageDestination, {
      source,
      name,
      version: manifest.version,
      license: manifest.license ?? "UNKNOWN",
      path: NodePath.relative(outputRoot, packageDestination).split(NodePath.sep).join("/"),
    });
    await NodeFSP.mkdir(NodePath.dirname(packageDestination), { recursive: true });
    await NodeFSP.cp(source, packageDestination, {
      recursive: true,
      dereference: true,
      filter: async (file) => {
        const relative = NodePath.relative(source, file);
        if (relative.split(NodePath.sep).some((part) => part === "node_modules" || part === ".git"))
          return false;
        if (
          relative
            .split(NodePath.sep)
            .some((part) => part === ".env" || part.startsWith(".env.") || part === ".npmrc")
        )
          throw new Error(`Private configuration found in runtime package ${name}`);
        const resolved = await NodeFSP.realpath(file);
        const resolvedRelative = NodePath.relative(source, resolved);
        if (
          resolvedRelative === ".." ||
          resolvedRelative.startsWith(`..${NodePath.sep}`) ||
          NodePath.isAbsolute(resolvedRelative)
        )
          throw new Error(`Runtime package ${name} contains an escaping symlink`);
        return true;
      },
    });
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    };
    for (const dependency of Object.keys(dependencies).sort()) {
      const optionalDependency =
        Object.hasOwn(manifest.optionalDependencies ?? {}, dependency) ||
        manifest.peerDependenciesMeta?.[dependency]?.optional === true;
      await visit(dependency, source, optionalDependency, packageDestination);
    }
  }
  for (const root of roots) await visit(root.name, root.fromDirectory, root.optional);
  return {
    packages: [...staged.values()]
      .map(({ source: _source, ...entry }) => entry)
      .sort((a, b) => a.path.localeCompare(b.path)),
    skippedOptionalPackages: [...skipped].sort(),
  };
}
