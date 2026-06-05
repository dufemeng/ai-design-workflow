import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { AdwConfig } from '../config/schema.js';
import type { ProjectContextSnapshot } from './snapshot.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.turbo', '.cache', 'out']);
const MAX_DEPTH = 4;
const MAX_FILES = 8000;

const KNOWN_FRAMEWORKS: Record<string, string> = {
  react: 'React',
  'react-router': 'React Router',
  'react-router-dom': 'React Router',
  vite: 'Vite',
  next: 'Next.js',
  vue: 'Vue',
  '@midwayjs/core': 'Midway',
  koa: 'Koa',
  express: 'Express',
  tailwindcss: 'Tailwind',
  '@tanstack/react-query': 'TanStack Query',
  typescript: 'TypeScript',
};

/** 扫描目标项目，产出 ProjectContextSnapshot。所有路径相对 targetDir，跳过 node_modules 等重目录。 */
export function scanProject(targetDir: string, config: AdwConfig): ProjectContextSnapshot {
  const files = walkFiles(targetDir);

  return {
    targetDir,
    purpose: scanPurpose(targetDir),
    techStack: scanTechStack(targetDir, files),
    designSignals: scanDesignSignals(targetDir, files),
    designLanguage: scanDesignLanguage(targetDir),
    designFlows: scanDesignFlows(targetDir, config.artifactDir),
  };
}

export function walkFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        visit(full, depth + 1);
      } else if (entry.isFile()) {
        out.push(relative(root, full));
      }
    }
  };
  visit(root, 0);
  return out;
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function readJsonSafe(path: string): Record<string, unknown> | null {
  const text = readFileSafe(path);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function scanPurpose(targetDir: string): ProjectContextSnapshot['purpose'] {
  const readme = readFileSafe(join(targetDir, 'README.md'));
  let readmeTitle: string | null = null;
  let readmeSummary: string | null = null;
  if (readme) {
    const lines = readme.split('\n');
    const titleLine = lines.find((l) => l.startsWith('# '));
    readmeTitle = titleLine ? titleLine.replace(/^#\s+/, '').trim() : null;
    // 标题之后第一段非空、非标题的文字。
    const titleIdx = titleLine ? lines.indexOf(titleLine) : -1;
    for (let i = titleIdx + 1; i < lines.length; i++) {
      const line = (lines[i] ?? '').trim();
      if (line && !line.startsWith('#')) {
        readmeSummary = line.slice(0, 200);
        break;
      }
    }
  }
  return {
    readmeTitle,
    readmeSummary,
    hasClaudeMd: existsSync(join(targetDir, 'CLAUDE.md')),
    hasAgentsMd: existsSync(join(targetDir, 'AGENTS.md')),
  };
}

function scanTechStack(targetDir: string, files: string[]): ProjectContextSnapshot['techStack'] {
  const rootPkg = readJsonSafe(join(targetDir, 'package.json'));
  const packageName = typeof rootPkg?.name === 'string' ? rootPkg.name : null;

  const isMonorepo =
    existsSync(join(targetDir, 'pnpm-workspace.yaml')) || Array.isArray((rootPkg as { workspaces?: unknown })?.workspaces);

  let packageManager: string | null = null;
  const pmField = rootPkg?.packageManager;
  if (typeof pmField === 'string') packageManager = pmField.split('@')[0] ?? null;
  else if (existsSync(join(targetDir, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (existsSync(join(targetDir, 'yarn.lock'))) packageManager = 'yarn';
  else if (existsSync(join(targetDir, 'package-lock.json'))) packageManager = 'npm';

  const pmPrefix = packageManager ?? 'npm';
  const startCommands: string[] = [];
  const scripts = rootPkg?.scripts;
  if (scripts && typeof scripts === 'object') {
    for (const key of Object.keys(scripts as Record<string, unknown>)) {
      if (/^(dev|start)(:|$)/.test(key)) startCommands.push(`${pmPrefix} ${key}`);
    }
  }

  // 跨 monorepo 收集所有 package.json 的依赖名，匹配已知框架。
  const frameworks = new Set<string>();
  for (const rel of files) {
    if (basename(rel) !== 'package.json') continue;
    const pkg = readJsonSafe(join(targetDir, rel));
    if (!pkg) continue;
    for (const field of ['dependencies', 'devDependencies'] as const) {
      const deps = pkg[field];
      if (deps && typeof deps === 'object') {
        for (const dep of Object.keys(deps as Record<string, unknown>)) {
          const label = KNOWN_FRAMEWORKS[dep];
          if (label) frameworks.add(label);
        }
      }
    }
  }

  return { packageName, isMonorepo, packageManager, startCommands: startCommands.slice(0, 8), frameworks: [...frameworks].sort() };
}

function scanDesignSignals(targetDir: string, files: string[]): ProjectContextSnapshot['designSignals'] {
  let cssFileCount = 0;
  const tokenFiles: string[] = [];
  const componentDirs = new Set<string>();
  let hasTailwind = files.some((f) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(f));

  for (const rel of files) {
    const base = basename(rel);
    if (/\.css$/.test(base)) cssFileCount++;
    if (/(token|theme)/i.test(base) && /\.(ts|js|css|json|cjs|mjs)$/.test(base)) {
      if (tokenFiles.length < 20) tokenFiles.push(rel);
    }
    if (base === 'components') componentDirs.add(rel);
  }
  // 目录名 components 也算（walkFiles 只收文件，这里从路径里提取）。
  for (const rel of files) {
    const m = rel.match(/(^|\/)(components)(\/|$)/);
    if (m) {
      const idx = rel.indexOf('components');
      componentDirs.add(rel.slice(0, idx + 'components'.length));
    }
  }

  return {
    hasTailwind,
    cssFileCount,
    tokenFiles,
    componentDirs: [...componentDirs].slice(0, 20),
  };
}

function scanDesignLanguage(targetDir: string): ProjectContextSnapshot['designLanguage'] {
  const impeccableDir = join(targetDir, '.impeccable');
  const critiqueDir = join(impeccableDir, 'critique');
  let critiqueCount = 0;
  if (existsSync(critiqueDir)) {
    try {
      critiqueCount = readdirSync(critiqueDir).filter((f) => f.endsWith('.md')).length;
    } catch {
      critiqueCount = 0;
    }
  }
  return {
    hasDesignMd: existsSync(join(targetDir, 'DESIGN.md')),
    hasProductMd: existsSync(join(targetDir, 'PRODUCT.md')),
    impeccable: {
      present: existsSync(impeccableDir),
      hasDesignJson: existsSync(join(impeccableDir, 'design.json')),
      critiqueCount,
      hasLive: existsSync(join(impeccableDir, 'live')),
    },
  };
}

function scanDesignFlows(targetDir: string, artifactDir: string): ProjectContextSnapshot['designFlows'] {
  const dir = join(targetDir, artifactDir);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const flows: ProjectContextSnapshot['designFlows'] = [];
  for (const name of names) {
    const m = name.match(/^design-(.+)\.md$/);
    if (!m || !m[1]) continue;
    const slug = m[1];
    if (!statSafe(join(dir, name))) continue;
    flows.push({
      slug,
      mdPath: join(artifactDir, name),
      hasHtml: existsSync(join(dir, `design-${slug}.html`)),
    });
  }
  return flows.sort((a, b) => a.slug.localeCompare(b.slug));
}

function statSafe(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
