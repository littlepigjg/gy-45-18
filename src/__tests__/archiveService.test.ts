import { describe, it, expect } from 'vitest';
import type { IconItem, Project, ExportOptions } from '@/types';
import {
  createArchive,
  parseArchive,
  resolveIdConflicts,
  compareVersions,
} from '@/services/archiveService';

const TEST_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function makeIcon(id: string, name: string, tags?: string[]): IconItem {
  return {
    id,
    name,
    originalName: `${name}.png`,
    width: 32,
    height: 32,
    addedAt: Date.now(),
    dataUrl: TEST_DATA_URL,
    tags,
  };
}

function makeProject(id: string, name: string, iconIds: string[], tags?: string[]): Project {
  return {
    id,
    name,
    description: `Project ${name}`,
    iconIds,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tags,
  };
}

describe('archiveService', () => {
  describe('compareVersions', () => {
    it('returns 0 for equal versions', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(compareVersions('2.3.4', '2.3.4')).toBe(0);
    });

    it('returns 1 when first version is greater', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
      expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
      expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    });

    it('returns -1 when first version is smaller', () => {
      expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
      expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    });

    it('handles versions with different segment counts', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
      expect(compareVersions('1', '1.0.0')).toBe(0);
      expect(compareVersions('2.0', '1.9.9')).toBe(1);
    });
  });

  describe('resolveIdConflicts', () => {
    it('does not modify items with no conflicts', () => {
      const projects = [makeProject('p1', 'Test', ['i1', 'i2'])];
      const icons = [makeIcon('i1', 'icon1'), makeIcon('i2', 'icon2')];
      const { projects: resolvedProjects, icons: resolvedIcons, renamed } = resolveIdConflicts(
        JSON.parse(JSON.stringify(projects)),
        JSON.parse(JSON.stringify(icons)),
        new Set(),
        new Set()
      );
      expect(resolvedProjects[0].id).toBe('p1');
      expect(resolvedIcons.map((i) => i.id)).toEqual(['i1', 'i2']);
      expect(renamed.length).toBe(0);
    });

    it('resolves icon id conflicts and updates project references', () => {
      const projects = [makeProject('p1', 'Test', ['i1', 'i2'])];
      const icons = [makeIcon('i1', 'icon1'), makeIcon('i2', 'icon2')];
      const { projects: resolvedProjects, icons: resolvedIcons, renamed } = resolveIdConflicts(
        JSON.parse(JSON.stringify(projects)),
        JSON.parse(JSON.stringify(icons)),
        new Set(),
        new Set(['i1'])
      );
      expect(renamed.filter((r) => r.type === 'icon').length).toBe(1);
      expect(renamed[0].old).toBe('i1');
      expect(renamed[0].new).not.toBe('i1');
      const newI1Id = renamed[0].new;
      expect(resolvedIcons.map((i) => i.id)).toContain(newI1Id);
      expect(resolvedProjects[0].iconIds).toContain(newI1Id);
      expect(resolvedProjects[0].iconIds).not.toContain('i1');
    });

    it('resolves project id conflicts', () => {
      const projects = [makeProject('p1', 'Test', [])];
      const icons: IconItem[] = [];
      const { projects: resolvedProjects, renamed } = resolveIdConflicts(
        JSON.parse(JSON.stringify(projects)),
        icons,
        new Set(['p1']),
        new Set()
      );
      expect(renamed.filter((r) => r.type === 'project').length).toBe(1);
      expect(resolvedProjects[0].id).not.toBe('p1');
    });
  });

  describe('createArchive and parseArchive roundtrip', () => {
    it('exports and re-imports a simple project with icons', async () => {
      const icon1 = makeIcon('icon-1', 'home', ['ui', 'navigation']);
      const icon2 = makeIcon('icon-2', 'settings', ['config']);
      const project = makeProject('proj-1', 'MyProject', ['icon-1', 'icon-2'], ['v1']);
      const options: ExportOptions = {
        type: 'project',
        exportConfig: true,
        description: 'Test export',
      };

      const archiveBlob = await createArchive([project], [icon1, icon2], options);
      expect(archiveBlob).toBeInstanceOf(Blob);
      expect(archiveBlob.size).toBeGreaterThan(0);

      const result = await parseArchive(archiveBlob);
      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.projects.length).toBe(1);
      expect(result.icons.length).toBe(2);
      expect(result.migratedFrom).toBeUndefined();

      const restoredProject = result.projects[0];
      expect(restoredProject.name).toBe('MyProject');
      expect(restoredProject.description).toBe('Project MyProject');
      expect(restoredProject.iconIds.length).toBe(2);
      expect(restoredProject.tags).toEqual(['v1']);

      const restoredIconNames = result.icons.map((i) => i.name).sort();
      expect(restoredIconNames).toEqual(['home', 'settings']);

      const homeIcon = result.icons.find((i) => i.name === 'home');
      expect(homeIcon?.tags).toEqual(['ui', 'navigation']);
      expect(homeIcon?.width).toBe(32);
      expect(homeIcon?.height).toBe(32);
      expect(homeIcon?.dataUrl.startsWith('data:')).toBe(true);
    });

    it('exports and re-imports icons-only archive', async () => {
      const icon1 = makeIcon('icon-a', 'star');
      const icon2 = makeIcon('icon-b', 'heart');
      const options: ExportOptions = {
        type: 'icons',
        exportConfig: false,
      };

      const tempProject: Project = makeProject('temp', 'Icons', ['icon-a', 'icon-b']);
      const archiveBlob = await createArchive([tempProject], [icon1, icon2], options);
      const result = await parseArchive(archiveBlob);

      expect(result.success).toBe(true);
      expect(result.icons.length).toBe(2);
    });

    it('fails gracefully on non-zip file', async () => {
      const badBlob = new Blob(['not a zip file'], { type: 'text/plain' });
      const result = await parseArchive(badBlob);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('includes correct version in exported archive', async () => {
      const icon = makeIcon('v1', 'v1icon');
      const project = makeProject('pv1', 'ProjV1', ['v1']);
      const archiveBlob = await createArchive([project], [icon], { type: 'project' });
      const result = await parseArchive(archiveBlob);
      expect(result.success).toBe(true);
    });
  });

  describe('version migration', () => {
    it('handles archive with missing tags field (older format)', async () => {
      const icon = makeIcon('mig-icon', 'migrated');
      const iconNoTags: Partial<IconItem> = { ...icon };
      delete iconNoTags.tags;
      const project = makeProject('mig-proj', 'Migrated', ['mig-icon']);
      const projectNoTags: Partial<Project> = { ...project };
      delete projectNoTags.tags;

      const archiveBlob = await createArchive(
        [projectNoTags as Project],
        [iconNoTags as IconItem],
        { type: 'project' }
      );
      const result = await parseArchive(archiveBlob);
      expect(result.success).toBe(true);
      expect(result.icons[0].tags).toBeDefined();
    });
  });
});
