import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Forge's plugin-vite does not copy `node_modules` into the packaged app — it
// expects everything to be bundled. We bundle the pure-JS deps, but the native
// libnut binary cannot be bundled; it must be loaded via require() at runtime.
// This hook copies the libnut module from the project's node_modules into the
// packaged app so the bundled `require('@nut-tree-fork/libnut-win32')` resolves.
// Walks the dependency tree of a list of root packages and copies every
// production dep into the packaged app, mirroring the source's node_modules
// layout (preserves nested node_modules from npm's resolution). This is
// necessary because npm sometimes installs different versions of a package
// at different depths, and packages may depend on the nested version.
function copyDepTree(roots: string[], srcRoot: string, destRoot: string): string[] {
  // Resolve a dep name from a starting directory by walking up node_modules
  // chain, the same way Node's resolver does.
  function resolvePkg(name: string, fromDir: string): string | null {
    let cur = fromDir;
    while (true) {
      const candidate = path.join(cur, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
      const parent = path.dirname(cur);
      if (parent === cur) return null; // filesystem root
      cur = parent;
    }
  }

  const visited = new Set<string>(); // keyed by absolute pkg path
  const copied: string[] = [];
  // Each queue entry: { name: package name, from: dir to resolve from }
  const queue: Array<{ name: string; from: string }> = roots.map((n) => ({
    name: n,
    from: srcRoot,
  }));

  while (queue.length > 0) {
    const { name, from } = queue.shift()!;
    const pkgPath = resolvePkg(name, from);
    if (!pkgPath) {
      console.warn(`[afterCopy] skip ${name} — not resolvable from ${from}`);
      continue;
    }
    if (visited.has(pkgPath)) continue;
    visited.add(pkgPath);

    // Mirror the same relative path in the destination — preserves nesting.
    const rel = path.relative(srcRoot, pkgPath);
    const dest = path.join(destRoot, rel);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(pkgPath, dest, { recursive: true });
      copied.push(rel);
    }

    // Recurse into this package's runtime deps, resolving each from this
    // package's location (so nested node_modules are honored).
    const pjPath = path.join(pkgPath, 'package.json');
    if (fs.existsSync(pjPath)) {
      try {
        const json = JSON.parse(fs.readFileSync(pjPath, 'utf8')) as {
          dependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
        };
        const deps = { ...(json.dependencies ?? {}), ...(json.optionalDependencies ?? {}) };
        for (const dep of Object.keys(deps)) {
          queue.push({ name: dep, from: pkgPath });
        }
      } catch {
        /* ignore malformed package.json */
      }
    }
  }
  return copied;
}

function copyNativeModulesHook(
  buildPath: string,
  _electronVersion: string,
  platform: string,
  _arch: string,
  callback: (err?: Error) => void
) {
  try {
    // Walk the full runtime dep tree of these roots and copy everything.
    const roots = ['@nut-tree-fork/nut-js', 'bindings', 'file-uri-to-path'];
    const copied = copyDepTree(roots, __dirname, buildPath);
    console.log(`[afterCopy] copied ${copied.length} packages from runtime dep tree`);

    // The bundled main.js eagerly require()s libnut-{win32,darwin,linux} for all
    // three platforms (Vite hoists conditional requires). On the host platform,
    // the require for the WRONG-platform package tries to dlopen its libnut.node,
    // which is a binary for a different OS — fails with Windows error 193
    // (ERROR_BAD_EXE_FORMAT) or equivalent on other systems.
    //
    // Fix: keep the package directory (so the require itself succeeds) but
    // replace index.js with a stub that returns {} instead of calling bindings.
    // The runtime dispatch in @nut-tree-fork/libnut/import_libnut.js picks the
    // correct platform's module via a process.platform check, so the stubs are
    // never used at runtime — they just need to load without crashing.
    const wrongPlatforms = ['libnut-win32', 'libnut-darwin', 'libnut-linux'].filter(
      (p) => p !== `libnut-${platform}`
    );
    const stubSrc =
      '// Stub for non-host platform. The bundled main.js eagerly require()s this\n' +
      '// package, but the runtime dispatcher in @nut-tree-fork/libnut picks the\n' +
      '// correct platform via process.platform, so this stub is never USED — it\n' +
      '// just needs to load without trying to dlopen a foreign-platform binary.\n' +
      'module.exports = {};\n' +
      'module.exports.screen = {};\n';
    for (const wp of wrongPlatforms) {
      const indexPath = path.join(buildPath, 'node_modules', '@nut-tree-fork', wp, 'index.js');
      if (fs.existsSync(indexPath)) {
        fs.writeFileSync(indexPath, stubSrc, 'utf8');
        console.log(`[afterCopy] stubbed ${wp}/index.js (non-host platform)`);
      }
      // Also remove the .node file so it can't be dlopen'd accidentally.
      const releaseDir = path.join(
        buildPath,
        'node_modules',
        '@nut-tree-fork',
        wp,
        'build',
        'Release'
      );
      if (fs.existsSync(releaseDir)) {
        fs.rmSync(releaseDir, { recursive: true, force: true });
        console.log(`[afterCopy] removed ${wp}/build/Release (foreign binary)`);
      }
    }
    callback();
  } catch (err) {
    callback(err as Error);
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    // asar disabled: with asar enabled, Windows dlopen() cannot resolve
    // libnut.node's sibling DLLs (vcruntime, msvc) because asar's virtual
    // filesystem confuses LoadLibrary. Disabling asar puts everything on
    // the real filesystem — bulletproof, slightly larger app, no downside
    // for this use case.
    asar: false,
    name: 'Interview Copilot',
    executableName: 'interview-copilot',
    icon: 'assets/icon',
    appCopyright: `© ${new Date().getFullYear()} Luiz Gustavo Graciano`,
    appCategoryType: 'public.app-category.productivity',
    win32metadata: {
      CompanyName: 'Luiz Gustavo Graciano',
      ProductName: 'Interview Copilot',
      FileDescription: 'Real-time AI interview assistant',
    },
    afterCopy: [copyNativeModulesHook],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'interview-copilot',
      authors: 'Luiz Gustavo Graciano',
      description: 'Real-time AI interview assistant',
      setupExe: 'Interview Copilot Setup.exe',
      setupIcon: 'assets/icon.ico',
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    // AutoUnpackNatives is intentionally NOT used here — our asar.unpackDir glob
    // does a more thorough job (includes DLLs that AutoUnpackNatives misses).
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.mts' }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // These two MUST be false because we disabled asar above — turning them
      // on while asar is off makes Electron refuse to boot (silent failure).
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};

export default config;
