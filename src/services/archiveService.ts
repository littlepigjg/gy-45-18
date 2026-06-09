import JSZip from 'jszip';
import type {
  ArchiveManifest,
  ArchiveMetaV1,
  ArchiveIconData,
  ArchiveProjectData,
  IconItem,
  IconMeta,
  Project,
  ImportResult,
  ExportOptions,
  VersionMigrator,
} from '../types';
import { ARCHIVE_VERSION } from '../types';
import { dataUrlToBlob, blobToDataUrl } from '../utils/db';
import { generateId } from '../utils';

const MANIFEST_FILE = 'manifest.json';
const ICONS_DIR = 'icons/';
const METADATA_DIR = 'metadata/';
const APP_VERSION = '1.0.0';
const EXPORTED_BY = 'CSS Sprite Tool';

function getMimeFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    default: return 'image/png';
  }
}

function getExtensionFromMime(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    case 'image/svg+xml': return 'svg';
    default: return 'png';
  }
}

function sanitizeFileName(name: string): string {
  const invalidChars = '<>:"/\\|?*';
  let result = '';
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code <= 31 || invalidChars.indexOf(name.charAt(i)) !== -1) {
      result += '_';
    } else {
      result += name.charAt(i);
    }
  }
  return result.substring(0, 100);
}

interface MigrationData {
  meta?: ArchiveMetaV1;
  icons?: ArchiveIconData[];
  projects?: ArchiveProjectData[];
  [key: string]: unknown;
}

const versionMigrators: VersionMigrator[] = [
  {
    targetVersion: '1.0.0',
    migrate: (data: unknown) => {
      const warnings: string[] = [];
      const d = (data || {}) as MigrationData;
      if (!d.meta) {
        d.meta = {
          version: '1.0.0',
          appVersion: 'unknown',
          exportedAt: Date.now(),
          exportedBy: EXPORTED_BY,
          type: 'project',
        };
        warnings.push('缺少元数据，已自动补充默认值');
      }
      if (!d.icons) d.icons = [];
      if (!d.projects) d.projects = [];
      d.icons = d.icons.map((icon) => ({
        ...icon,
        tags: icon.tags || [],
      }));
      d.projects = d.projects.map((proj) => ({
        ...proj,
        tags: proj.tags || [],
        iconIds: proj.iconIds || [],
      }));
      return { data: d, warnings };
    },
  },
];

function migrateArchiveData(data: unknown, sourceVersion: string): { data: unknown; warnings: string[] } {
  const allWarnings: string[] = [];
  const migrations = versionMigrators
    .filter((m) => compareVersions(m.targetVersion, sourceVersion) > 0)
    .sort((a, b) => compareVersions(a.targetVersion, b.targetVersion));

  let currentData: unknown = typeof data === 'object' && data !== null ? { ...(data as Record<string, unknown>) } : data;
  for (const migration of migrations) {
    const { data: migratedData, warnings } = migration.migrate(currentData);
    currentData = migratedData;
    allWarnings.push(...warnings.map((w) => `[${migration.targetVersion}] ${w}`));
  }
  return { data: currentData, warnings: allWarnings };
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map((n) => parseInt(n, 10) || 0);
  const bParts = b.split('.').map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < maxLen; i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal > bVal) return 1;
    if (aVal < bVal) return -1;
  }
  return 0;
}

function generateChecksum(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export async function createArchive(
  projects: Project[],
  icons: IconItem[],
  options: ExportOptions
): Promise<Blob> {
  const zip = new JSZip();
  const iconFileNameMap = new Map<string, string>();
  const usedFileNames = new Set<string>();

  const archiveIcons: ArchiveIconData[] = icons.map((icon) => {
    let baseName = sanitizeFileName(icon.name);
    if (!baseName) baseName = 'icon';
    const ext = getExtensionFromMime(
      icon.dataUrl.startsWith('data:')
        ? (icon.dataUrl.match(/data:(.*?);/)?.[1] || 'image/png')
        : 'image/png'
    );
    let fileName = `${baseName}.${ext}`;
    let counter = 1;
    while (usedFileNames.has(fileName)) {
      fileName = `${baseName}_${counter}.${ext}`;
      counter++;
    }
    usedFileNames.add(fileName);
    iconFileNameMap.set(icon.id, fileName);

    return {
      id: icon.id,
      name: icon.name,
      originalName: icon.originalName,
      width: icon.width,
      height: icon.height,
      addedAt: icon.addedAt,
      tags: icon.tags || [],
      fileName,
      mime: getMimeFromFileName(fileName),
    };
  });

  const archiveProjects: ArchiveProjectData[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    iconIds: project.iconIds.filter((id) => iconFileNameMap.has(id)),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    tags: project.tags || [],
    spriteConfig: options.exportConfig ? project.spriteConfig : undefined,
  }));

  const meta: ArchiveMetaV1 = {
    version: ARCHIVE_VERSION,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    exportedBy: EXPORTED_BY,
    type: options.type,
    description: options.description,
  };

  for (const icon of icons) {
    const fileName = iconFileNameMap.get(icon.id);
    if (!fileName) continue;
    const blob = await dataUrlToBlob(icon.dataUrl);
    zip.file(`${ICONS_DIR}${fileName}`, blob);
  }

  const manifest: ArchiveManifest = {
    meta,
    projects: archiveProjects,
    icons: archiveIcons,
    checksum: undefined,
  };

  const manifestContent = JSON.stringify(manifest, null, 2);
  manifest.checksum = generateChecksum(manifestContent + ARCHIVE_VERSION);

  zip.file(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  zip.file(`${METADATA_DIR}README.txt`, generateReadme(meta, archiveProjects.length, archiveIcons.length));

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

function generateReadme(meta: ArchiveMetaV1, projectCount: number, iconCount: number): string {
  const date = new Date(meta.exportedAt).toISOString();
  return [
    'CSS Sprite Tool Archive',
    '======================',
    '',
    `Version: ${meta.version}`,
    `App Version: ${meta.appVersion}`,
    `Exported At: ${date}`,
    `Exported By: ${meta.exportedBy}`,
    `Type: ${meta.type}`,
    `Projects: ${projectCount}`,
    `Icons: ${iconCount}`,
    meta.description ? `Description: ${meta.description}` : '',
    '',
    'Structure:',
    '  - manifest.json    完整的归档元数据和清单',
    '  - icons/           所有图标图片文件',
    '  - metadata/        额外的元数据文件',
    '',
    'This archive can be imported back into the CSS Sprite Tool.',
  ].filter(Boolean).join('\n');
}

export async function parseArchive(file: File | Blob): Promise<ImportResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const result: ImportResult = {
    success: false,
    projects: [],
    icons: [],
    warnings,
    errors,
  };

  try {
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file(MANIFEST_FILE);
    if (!manifestFile) {
      errors.push('归档文件缺少 manifest.json，无法识别为有效的导出文件');
      return result;
    }

    let manifestRaw: string;
    try {
      manifestRaw = await manifestFile.async('string');
    } catch {
      errors.push('读取 manifest.json 失败');
      return result;
    }

    let manifestData: unknown;
    try {
      manifestData = JSON.parse(manifestRaw);
    } catch {
      errors.push('解析 manifest.json 失败，文件可能已损坏');
      return result;
    }

    const parsedManifest = manifestData as { meta?: { version?: string } };
    if (!parsedManifest.meta || !parsedManifest.meta.version) {
      errors.push('manifest.json 缺少版本信息');
      return result;
    }

    const sourceVersion = parsedManifest.meta.version;
    if (compareVersions(sourceVersion, ARCHIVE_VERSION) > 0) {
      warnings.push(
        `归档版本 (${sourceVersion}) 高于当前应用版本 (${ARCHIVE_VERSION})，部分功能可能无法正常使用`
      );
    }

    let migratedData = manifestData;
    if (compareVersions(sourceVersion, ARCHIVE_VERSION) < 0) {
      const { data, warnings: migrationWarnings } = migrateArchiveData(manifestData, sourceVersion);
      migratedData = data;
      warnings.push(...migrationWarnings);
      result.migratedFrom = sourceVersion;
      if (migrationWarnings.length > 0) {
        warnings.push(`已从版本 ${sourceVersion} 迁移到 ${ARCHIVE_VERSION}`);
      }
    }

    const manifest = migratedData as ArchiveManifest;
    if (manifest.checksum) {
      const manifestCopy: ArchiveManifest = { ...manifest, checksum: undefined };
      const computedChecksum = generateChecksum(JSON.stringify(manifestCopy, null, 2) + ARCHIVE_VERSION);
      if (computedChecksum !== manifest.checksum) {
        warnings.push('归档校验和不匹配，文件可能已被修改');
      }
    }

    const icons: IconItem[] = [];
    const iconDir = zip.folder(ICONS_DIR);

    for (const archiveIcon of manifest.icons) {
      const iconFile = iconDir?.file(archiveIcon.fileName) || zip.file(`${ICONS_DIR}${archiveIcon.fileName}`);
      if (!iconFile) {
        warnings.push(`图标 "${archiveIcon.name}" 的文件缺失 (${archiveIcon.fileName})，已跳过`);
        continue;
      }

      try {
        const blob = await iconFile.async('blob');
        const dataUrl = await blobToDataUrl(blob);
        const iconMeta: IconMeta = {
          id: archiveIcon.id,
          name: archiveIcon.name,
          originalName: archiveIcon.originalName,
          width: archiveIcon.width,
          height: archiveIcon.height,
          addedAt: archiveIcon.addedAt,
          tags: archiveIcon.tags,
        };
        icons.push({ ...iconMeta, dataUrl });
      } catch {
        warnings.push(`读取图标 "${archiveIcon.name}" 失败，已跳过`);
      }
    }

    const importedIconIds = new Set(icons.map((i) => i.id));
    const projects: Project[] = manifest.projects.map((proj) => ({
      id: proj.id,
      name: proj.name,
      description: proj.description,
      iconIds: proj.iconIds.filter((id) => importedIconIds.has(id)),
      createdAt: proj.createdAt,
      updatedAt: proj.updatedAt,
      tags: proj.tags,
      spriteConfig: proj.spriteConfig,
    }));

    const skippedIcons = manifest.icons.length - icons.length;
    const skippedProjectIcons = manifest.projects.reduce(
      (sum, p) => sum + (p.iconIds.length - (projects.find((pp) => pp.id === p.id)?.iconIds.length || 0)),
      0
    );
    if (skippedIcons > 0) {
      warnings.push(`共 ${skippedIcons} 个图标因数据问题未能导入`);
    }
    if (skippedProjectIcons > 0) {
      warnings.push(`${skippedProjectIcons} 个项目-图标关联因图标缺失被移除`);
    }

    result.success = true;
    result.projects = projects;
    result.icons = icons;
  } catch (e) {
    errors.push(`解析归档文件失败：${e instanceof Error ? e.message : '未知错误'}`);
  }

  return result;
}

export function resolveIdConflicts(
  importedProjects: Project[],
  importedIcons: IconItem[],
  existingProjectIds: Set<string>,
  existingIconIds: Set<string>
): { projects: Project[]; icons: IconItem[]; renamed: { old: string; new: string; type: 'project' | 'icon' }[] } {
  const idMap = new Map<string, string>();
  const renamed: { old: string; new: string; type: 'project' | 'icon' }[] = [];

  for (const icon of importedIcons) {
    if (existingIconIds.has(icon.id)) {
      const newId = generateId();
      idMap.set(icon.id, newId);
      renamed.push({ old: icon.id, new: newId, type: 'icon' });
      icon.id = newId;
    }
  }

  for (const project of importedProjects) {
    if (existingProjectIds.has(project.id)) {
      const newId = generateId();
      idMap.set(project.id, newId);
      renamed.push({ old: project.id, new: newId, type: 'project' });
      project.id = newId;
    }
    project.iconIds = project.iconIds.map((id) => idMap.get(id) || id);
  }

  return { projects: importedProjects, icons: importedIcons, renamed };
}

export { ARCHIVE_VERSION, compareVersions };
