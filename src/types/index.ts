export interface IconMeta {
  id: string;
  name: string;
  originalName: string;
  width: number;
  height: number;
  addedAt: number;
  tags?: string[];
}

export interface IconItem extends IconMeta {
  dataUrl: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  iconIds: string[];
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  spriteConfig?: SpriteConfig;
}

export interface SpriteConfig {
  columns: number;
  spacing: number;
  bgColor: string;
  classPrefix: string;
  retina: boolean;
}

export interface IconPosition {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteResult {
  imageDataUrl: string;
  cssCode: string;
  scssCode: string;
  iconPositions: IconPosition[];
  totalWidth: number;
  totalHeight: number;
  cellWidth: number;
  cellHeight: number;
}

export interface SplitConfig {
  rows: number;
  columns: number;
  iconWidth: number;
  iconHeight: number;
  spacing: number;
  padding: number;
}

export interface SplitIcon {
  index: number;
  dataUrl: string;
  width: number;
  height: number;
  name: string;
}

export const ARCHIVE_VERSION = '1.0.0';

export interface ArchiveMetaV1 {
  version: string;
  appVersion: string;
  exportedAt: number;
  exportedBy: string;
  type: 'project' | 'icons';
  description?: string;
}

export interface ArchiveIconData {
  id: string;
  name: string;
  originalName: string;
  width: number;
  height: number;
  addedAt: number;
  tags?: string[];
  fileName: string;
  mime: string;
}

export interface ArchiveProjectData {
  id: string;
  name: string;
  description: string;
  iconIds: string[];
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  spriteConfig?: SpriteConfig;
}

export interface ArchiveManifest {
  meta: ArchiveMetaV1;
  projects: ArchiveProjectData[];
  icons: ArchiveIconData[];
  checksum?: string;
}

export interface ImportResult {
  success: boolean;
  projects: Project[];
  icons: IconItem[];
  warnings: string[];
  errors: string[];
  migratedFrom?: string;
}

export interface ExportOptions {
  includeProjects?: string[];
  includeIconIds?: string[];
  type: 'project' | 'icons';
  description?: string;
  exportConfig?: boolean;
}

export type ArchiveVersion = string;

export interface VersionMigrator {
  targetVersion: string;
  migrate: (data: unknown) => { data: unknown; warnings: string[] };
}
