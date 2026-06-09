import { create } from 'zustand';
import type { IconMeta, IconItem, Project, SpriteConfig, ImportResult, ExportOptions } from '../types';
import { generateId, iconItemToMeta, downloadBlob } from '../utils';
import {
  saveIconDataUrl,
  getIconDataUrl,
  deleteIconBlob,
  deleteIconBulk,
} from '../utils/db';
import {
  createArchive,
  parseArchive,
  resolveIdConflicts,
} from '../services/archiveService';

const STORAGE_KEY = 'css-sprite-tool-data';

type ToastFn = (msg: string) => void;
interface ToastHandlers {
  showSuccess: ToastFn;
  showError: ToastFn;
  showWarning: ToastFn;
  showInfo: ToastFn;
}

let toastHandlers: ToastHandlers = {
  showSuccess: () => {},
  showError: (m) => console.error(m),
  showWarning: (m) => console.warn(m),
  showInfo: (m) => console.info(m),
};

export function setStoreToastHandlers(handlers: ToastHandlers) {
  toastHandlers = handlers;
}

interface PersistedData {
  projects: Project[];
  icons: IconMeta[];
}

interface AppState {
  projects: Project[];
  icons: IconMeta[];
  activeProjectId: string | null;
  generatorIcons: IconItem[];
  spriteConfig: SpriteConfig;

  setToastHandlers: (handlers: ToastHandlers) => void;

  addIcons: (icons: IconItem[]) => Promise<void>;
  removeIcon: (id: string) => Promise<void>;
  clearGeneratorIcons: () => void;
  setGeneratorIcons: (icons: IconItem[]) => void;
  updateSpriteConfig: (config: Partial<SpriteConfig>) => void;

  createProject: (name: string, description?: string) => Project;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => void;
  setActiveProject: (id: string | null) => void;
  addIconsToProject: (projectId: string, iconIds: string[]) => void;
  removeIconFromProject: (projectId: string, iconId: string) => void;

  getIconsInProject: (projectId: string) => Promise<{
    items: IconItem[];
    total: number;
    loaded: number;
    failed: number;
  }>;
  getIconItem: (meta: IconMeta) => Promise<IconItem | null>;

  addIconTags: (iconId: string, tags: string[]) => void;
  removeIconTag: (iconId: string, tag: string) => void;
  addProjectTags: (projectId: string, tags: string[]) => void;
  removeProjectTag: (projectId: string, tag: string) => void;

  exportProject: (projectId: string, options?: Partial<ExportOptions>) => Promise<void>;
  exportSelectedIcons: (iconIds: string[], projectName?: string) => Promise<void>;
  importArchive: (file: File) => Promise<ImportResult>;
}

function loadFromStorage(): PersistedData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        projects: parsed.projects || [],
        icons: parsed.icons || [],
      };
    }
  } catch {
    toastHandlers.showError('读取本地数据失败');
  }
  return { projects: [], icons: [] };
}

function saveToStorage(projects: Project[], icons: IconMeta[]): boolean {
  try {
    const payload = JSON.stringify({ projects, icons });
    localStorage.setItem(STORAGE_KEY, payload);
    return true;
  } catch {
    toastHandlers.showError('本地存储失败，浏览器存储空间可能已满');
    return false;
  }
}

const initialData = loadFromStorage();

export const useAppStore = create<AppState>((set, get) => ({
  projects: initialData.projects,
  icons: initialData.icons,
  activeProjectId: initialData.projects[0]?.id || null,
  generatorIcons: [],
  spriteConfig: {
    columns: 5,
    spacing: 4,
    bgColor: 'transparent',
    classPrefix: 'sprite',
    retina: false,
  },

  setToastHandlers: (handlers) => {
    setStoreToastHandlers(handlers);
  },

  addIcons: async (items) => {
    if (items.length === 0) return;
    const metas: IconMeta[] = items.map(iconItemToMeta);

    try {
      for (const item of items) {
        await saveIconDataUrl(item.id, item.dataUrl);
      }
    } catch (e) {
      toastHandlers.showError('保存图片到本地数据库失败');
      throw e;
    }

    set((state) => {
      const newIcons = [...state.icons, ...metas];
      saveToStorage(state.projects, newIcons);
      return { icons: newIcons };
    });
    toastHandlers.showSuccess(`已保存 ${items.length} 个图标`);
  },

  removeIcon: async (id) => {
    try {
      await deleteIconBlob(id);
    } catch {
      toastHandlers.showError('删除图片数据失败');
    }

    set((state) => {
      const newIcons = state.icons.filter((i) => i.id !== id);
      const newProjects = state.projects.map((p) => ({
        ...p,
        iconIds: p.iconIds.filter((iid) => iid !== id),
      }));
      saveToStorage(newProjects, newIcons);
      return { icons: newIcons, projects: newProjects };
    });
  },

  clearGeneratorIcons: () => set({ generatorIcons: [] }),

  setGeneratorIcons: (icons) => set({ generatorIcons: icons }),

  updateSpriteConfig: (config) =>
    set((state) => ({
      spriteConfig: { ...state.spriteConfig, ...config },
    })),

  createProject: (name, description = '') => {
    const project: Project = {
      id: generateId(),
      name,
      description,
      iconIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((state) => {
      const newProjects = [...state.projects, project];
      saveToStorage(newProjects, state.icons);
      return { projects: newProjects, activeProjectId: project.id };
    });
    toastHandlers.showSuccess(`项目 "${name}" 已创建`);
    return project;
  },

  deleteProject: async (id) => {
    const state = get();
    const project = state.projects.find((p) => p.id === id);
    const projectIconIds = new Set(project?.iconIds || []);
    const newProjects = state.projects.filter((p) => p.id !== id);
    const remainingProjectIconIds = new Set(
      newProjects.flatMap((p) => p.iconIds)
    );
    const orphanedIds = [...projectIconIds].filter(
      (iid) => !remainingProjectIconIds.has(iid)
    );

    if (orphanedIds.length > 0) {
      try {
        await deleteIconBulk(orphanedIds);
      } catch {
        toastHandlers.showError('清理图片数据失败');
      }
    }

    set((s) => {
      const newIcons = s.icons.filter((i) => !orphanedIds.includes(i.id));
      saveToStorage(newProjects, newIcons);
      return {
        projects: newProjects,
        icons: newIcons,
        activeProjectId:
          s.activeProjectId === id ? newProjects[0]?.id || null : s.activeProjectId,
      };
    });
    toastHandlers.showInfo('项目已删除');
  },

  renameProject: (id, name) => {
    set((state) => {
      const newProjects = state.projects.map((p) =>
        p.id === id ? { ...p, name, updatedAt: Date.now() } : p
      );
      saveToStorage(newProjects, state.icons);
      return { projects: newProjects };
    });
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  addIconsToProject: (projectId, iconIds) => {
    set((state) => {
      const newProjects = state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              iconIds: [...new Set([...p.iconIds, ...iconIds])],
              updatedAt: Date.now(),
            }
          : p
      );
      saveToStorage(newProjects, state.icons);
      return { projects: newProjects };
    });
  },

  removeIconFromProject: (projectId, iconId) => {
    set((state) => {
      const newProjects = state.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              iconIds: p.iconIds.filter((id) => id !== iconId),
              updatedAt: Date.now(),
            }
          : p
      );
      saveToStorage(newProjects, state.icons);
      return { projects: newProjects };
    });
  },

  getIconItem: async (meta) => {
    try {
      const dataUrl = await getIconDataUrl(meta.id);
      if (!dataUrl) {
        toastHandlers.showWarning(`图标 "${meta.name}" 数据缺失`);
        return null;
      }
      return { ...meta, dataUrl };
    } catch {
      toastHandlers.showError(`加载图标 "${meta.name}" 失败`);
      return null;
    }
  },

  getIconsInProject: async (projectId) => {
    const state = get();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return { items: [], total: 0, loaded: 0, failed: 0 };
    const metaMap = new Map(state.icons.map((i) => [i.id, i]));
    const metas = project.iconIds
      .map((id) => metaMap.get(id))
      .filter((m): m is IconMeta => !!m);

    const items: IconItem[] = [];
    let failed = 0;
    for (const meta of metas) {
      const item = await get().getIconItem(meta);
      if (item) items.push(item);
      else failed++;
    }
    if (failed > 0) {
      toastHandlers.showWarning(`成功加载 ${items.length} 个图标，${failed} 个加载失败`);
    }
    return { items, total: metas.length, loaded: items.length, failed };
  },

  addIconTags: (iconId, tags) => {
    set((state) => {
      const newIcons = state.icons.map((i) =>
        i.id === iconId
          ? { ...i, tags: [...new Set([...(i.tags || []), ...tags])] }
          : i
      );
      saveToStorage(state.projects, newIcons);
      return { icons: newIcons };
    });
  },

  removeIconTag: (iconId, tag) => {
    set((state) => {
      const newIcons = state.icons.map((i) =>
        i.id === iconId
          ? { ...i, tags: (i.tags || []).filter((t) => t !== tag) }
          : i
      );
      saveToStorage(state.projects, newIcons);
      return { icons: newIcons };
    });
  },

  addProjectTags: (projectId, tags) => {
    set((state) => {
      const newProjects = state.projects.map((p) =>
        p.id === projectId
          ? { ...p, tags: [...new Set([...(p.tags || []), ...tags])], updatedAt: Date.now() }
          : p
      );
      saveToStorage(newProjects, state.icons);
      return { projects: newProjects };
    });
  },

  removeProjectTag: (projectId, tag) => {
    set((state) => {
      const newProjects = state.projects.map((p) =>
        p.id === projectId
          ? { ...p, tags: (p.tags || []).filter((t) => t !== tag), updatedAt: Date.now() }
          : p
      );
      saveToStorage(newProjects, state.icons);
      return { projects: newProjects };
    });
  },

  exportProject: async (projectId, options = {}) => {
    const state = get();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) {
      toastHandlers.showError('项目不存在');
      return;
    }

    const { items: icons, failed } = await state.getIconsInProject(projectId);
    if (icons.length === 0) {
      toastHandlers.showError('项目中没有可导出的图标');
      return;
    }
    if (failed > 0) {
      toastHandlers.showWarning(`${failed} 个图标加载失败，将不会包含在导出文件中`);
    }

    try {
      const exportOptions: ExportOptions = {
        type: 'project',
        includeProjects: [projectId],
        exportConfig: true,
        description: `项目 "${project.name}" 的导出文件`,
        ...options,
      };
      const archive = await createArchive([project], icons, exportOptions);
      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = `${project.name.replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '_')}_${timestamp}.sprite.zip`;
      downloadBlob(archive, fileName);
      toastHandlers.showSuccess(`已导出项目 "${project.name}" (${icons.length} 个图标)`);
    } catch (e) {
      toastHandlers.showError(`导出失败：${e instanceof Error ? e.message : '未知错误'}`);
    }
  },

  exportSelectedIcons: async (iconIds, projectName) => {
    const state = get();
    const icons: IconItem[] = [];
    let failed = 0;

    for (const id of iconIds) {
      const meta = state.icons.find((i) => i.id === id);
      if (!meta) {
        failed++;
        continue;
      }
      const item = await state.getIconItem(meta);
      if (item) icons.push(item);
      else failed++;
    }

    if (icons.length === 0) {
      toastHandlers.showError('没有可导出的图标');
      return;
    }
    if (failed > 0) {
      toastHandlers.showWarning(`${failed} 个图标加载失败，将不会包含在导出文件中`);
    }

    try {
      const tempProject: Project = {
        id: generateId(),
        name: projectName || '导出图标集合',
        description: `包含 ${icons.length} 个图标的集合`,
        iconIds: icons.map((i) => i.id),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const exportOptions: ExportOptions = {
        type: 'icons',
        description: `${icons.length} 个图标的导出文件`,
        exportConfig: false,
      };
      const archive = await createArchive([tempProject], icons, exportOptions);
      const timestamp = new Date().toISOString().slice(0, 10);
      const baseName = projectName || 'icons_export';
      const fileName = `${baseName.replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '_')}_${icons.length}icons_${timestamp}.sprite.zip`;
      downloadBlob(archive, fileName);
      toastHandlers.showSuccess(`已导出 ${icons.length} 个图标`);
    } catch (e) {
      toastHandlers.showError(`导出失败：${e instanceof Error ? e.message : '未知错误'}`);
    }
  },

  importArchive: async (file) => {
    const result: ImportResult = {
      success: false,
      projects: [],
      icons: [],
      warnings: [],
      errors: [],
    };

    try {
      const parsed = await parseArchive(file);
      result.warnings = parsed.warnings;
      result.errors = parsed.errors;
      result.migratedFrom = parsed.migratedFrom;

      if (!parsed.success) {
        toastHandlers.showError(parsed.errors[0] || '导入失败，文件格式无效');
        return result;
      }

      const state = get();
      const existingProjectIds = new Set(state.projects.map((p) => p.id));
      const existingIconIds = new Set(state.icons.map((i) => i.id));

      const { projects: resolvedProjects, icons: resolvedIcons, renamed } = resolveIdConflicts(
        JSON.parse(JSON.stringify(parsed.projects)),
        JSON.parse(JSON.stringify(parsed.icons)),
        existingProjectIds,
        existingIconIds
      );

      if (renamed.length > 0) {
        const projectRenames = renamed.filter((r) => r.type === 'project').length;
        const iconRenames = renamed.filter((r) => r.type === 'icon').length;
        if (projectRenames > 0) {
          result.warnings.push(`${projectRenames} 个项目ID冲突已自动处理`);
        }
        if (iconRenames > 0) {
          result.warnings.push(`${iconRenames} 个图标ID冲突已自动处理`);
        }
      }

      try {
        for (const icon of resolvedIcons) {
          await saveIconDataUrl(icon.id, icon.dataUrl);
        }
      } catch {
        toastHandlers.showError('保存图标数据到本地数据库失败');
        result.errors.push('保存图标数据失败');
        return result;
      }

      const newIconMetas = resolvedIcons.map(iconItemToMeta);
      const mergedProjectNames = new Map<string, number>();
      state.projects.forEach((p) => mergedProjectNames.set(p.name, 1));

      const finalProjects = resolvedProjects.map((p) => {
        let finalName = p.name;
        let counter = 2;
        while (mergedProjectNames.has(finalName)) {
          finalName = `${p.name} (${counter++})`;
        }
        mergedProjectNames.set(finalName, 1);
        return { ...p, name: finalName };
      });

      set((s) => {
        const newIcons = [...s.icons, ...newIconMetas];
        const newProjects = [...s.projects, ...finalProjects];
        saveToStorage(newProjects, newIcons);
        return {
          icons: newIcons,
          projects: newProjects,
          activeProjectId: s.activeProjectId || finalProjects[0]?.id || null,
        };
      });

      result.success = true;
      result.projects = finalProjects;
      result.icons = resolvedIcons;

      const msg = `导入成功：${finalProjects.length} 个项目，${resolvedIcons.length} 个图标`;
      if (result.warnings.length > 0) {
        toastHandlers.showWarning(`${msg}（有 ${result.warnings.length} 条警告）`);
      } else {
        toastHandlers.showSuccess(msg);
      }
    } catch (e) {
      result.errors.push(`导入失败：${e instanceof Error ? e.message : '未知错误'}`);
      toastHandlers.showError(result.errors[0]);
    }

    return result;
  },
}));

export { generateId };
