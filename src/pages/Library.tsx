import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  FolderKanban,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Upload,
  FolderPlus,
  Grid3X3,
  Search,
  Image as ImageIcon,
  Calendar,
  ChevronRight,
  Loader2,
  AlertCircle,
  RefreshCw,
  AlertTriangle,
  Download,
  PackageOpen,
  Tag as TagIcon,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/useAppStore';
import { createIconItemsFromFiles, formatDate, cn } from '@/utils';
import { useToast } from '@/components/Toast';
import type { IconItem, Project, ImportResult } from '@/types';

export default function Library() {
  const navigate = useNavigate();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedIconIds, setSelectedIconIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; icon: IconItem } | null>(null);
  const [projectIcons, setProjectIcons] = useState<IconItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStats, setLoadStats] = useState<{ total: number; loaded: number; failed: number } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [importDialog, setImportDialog] = useState<{ show: boolean; result: ImportResult | null }>({ show: false, result: null });
  const [tagInput, setTagInput] = useState('');
  const [editingIconTags, setEditingIconTags] = useState<string | null>(null);

  const {
    projects,
    activeProjectId,
    setActiveProject,
    createProject,
    deleteProject,
    renameProject,
    addIcons,
    addIconsToProject,
    removeIconFromProject,
    getIconsInProject,
    setGeneratorIcons,
    updateSpriteConfig,
    exportProject,
    exportSelectedIcons,
    importArchive,
    addIconTags,
    removeIconTag,
  } = useAppStore();

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  const loadIcons = useCallback(async () => {
    if (!activeProjectId) {
      setProjectIcons([]);
      setLoadError(null);
      setLoadStats(null);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await getIconsInProject(activeProjectId);
      setProjectIcons(result.items);
      setLoadStats({ total: result.total, loaded: result.loaded, failed: result.failed });
      if (result.failed > 0 && result.loaded === 0) {
        setLoadError(`所有 ${result.total} 个图标均加载失败，图片数据可能已丢失`);
      } else if (result.failed > 0) {
        setLoadError(`${result.failed} 个图标加载失败，请检查本地存储或尝试刷新`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      setLoadError(`加载图标时发生错误：${msg}`);
      toast.showError('加载图标失败');
    } finally {
      setIsLoading(false);
    }
  }, [activeProjectId, getIconsInProject, toast]);

  useEffect(() => {
    let cancelled = false;
    if (!activeProjectId) {
      setProjectIcons([]);
      setLoadError(null);
      setLoadStats(null);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const result = await getIconsInProject(activeProjectId);
        if (cancelled) return;
        setProjectIcons(result.items);
        setLoadStats({ total: result.total, loaded: result.loaded, failed: result.failed });
        if (result.failed > 0 && result.loaded === 0) {
          setLoadError(`所有 ${result.total} 个图标均加载失败，图片数据可能已丢失`);
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : '未知错误';
        setLoadError(`加载图标时发生错误：${msg}`);
        toast.showError('加载图标失败');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeProjectId, getIconsInProject, loadAttempt, toast]);

  const filteredIcons = useMemo(() => {
    if (!searchQuery.trim()) return projectIcons;
    const q = searchQuery.toLowerCase();
    return projectIcons.filter((i) => i.name.toLowerCase().includes(q));
  }, [projectIcons, searchQuery]);

  const handleUpload = async (files: FileList | File[]) => {
    if (!activeProjectId) return;
    const newIcons = await createIconItemsFromFiles(files);
    if (newIcons.length === 0) return;
    try {
      await addIcons(newIcons);
      addIconsToProject(activeProjectId, newIcons.map((i) => i.id));
      setProjectIcons((prev) => [...prev, ...newIcons]);
      setLoadStats((prev) => prev ? {
        total: prev.total + newIcons.length,
        loaded: prev.loaded + newIcons.length,
        failed: prev.failed,
      } : null);
      setLoadError(null);
    } catch {
      /* toast already shown in store */
    }
  };

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    createProject(newProjectName.trim());
    setNewProjectName('');
    setShowNewProject(false);
  };

  const startRename = (p: Project) => {
    setEditingId(p.id);
    setEditingName(p.name);
  };

  const confirmRename = () => {
    if (editingId && editingName.trim()) {
      renameProject(editingId, editingName.trim());
    }
    setEditingId(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIconIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIconIds.size === filteredIcons.length) {
      setSelectedIconIds(new Set());
    } else {
      setSelectedIconIds(new Set(filteredIcons.map((i) => i.id)));
    }
  };

  const generateFromProject = () => {
    if (!activeProject || projectIcons.length === 0) return;
    setGeneratorIcons(projectIcons);
    updateSpriteConfig({ classPrefix: activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') });
    navigate('/generator');
  };

  const deleteSelected = () => {
    if (!activeProjectId || selectedIconIds.size === 0) return;
    selectedIconIds.forEach((id) => removeIconFromProject(activeProjectId, id));
    setProjectIcons((prev) => prev.filter((i) => !selectedIconIds.has(i.id)));
    setLoadStats((prev) => prev ? {
      ...prev,
      total: prev.total - selectedIconIds.size,
      loaded: prev.loaded - selectedIconIds.size,
    } : null);
    setSelectedIconIds(new Set());
  };

  const handleExportProject = async () => {
    if (!activeProjectId) return;
    await exportProject(activeProjectId);
  };

  const handleExportSelected = async () => {
    if (selectedIconIds.size === 0) return;
    await exportSelectedIcons(Array.from(selectedIconIds), activeProject?.name);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.zip') && !file.name.toLowerCase().endsWith('.sprite.zip')) {
      toast.showWarning('请选择 .sprite.zip 或 .zip 格式的归档文件');
      return;
    }
    const result = await importArchive(file);
    setImportDialog({ show: true, result });
    setLoadAttempt((n) => n + 1);
    if (importInputRef.current) importInputRef.current.value = '';
  };

  const handleAddIconTag = (iconId: string) => {
    const tag = tagInput.trim();
    if (!tag) return;
    addIconTags(iconId, [tag]);
    setProjectIcons((prev) =>
      prev.map((i) =>
        i.id === iconId
          ? { ...i, tags: [...new Set([...(i.tags || []), tag])] }
          : i
      )
    );
    setTagInput('');
  };

  const handleRemoveIconTag = (iconId: string, tag: string) => {
    removeIconTag(iconId, tag);
    setProjectIcons((prev) =>
      prev.map((i) =>
        i.id === iconId
          ? { ...i, tags: (i.tags || []).filter((t) => t !== tag) }
          : i
      )
    );
  };

  const handleDeleteProject = async (p: Project) => {
    if (!confirm(`删除项目 "${p.name}"?`)) return;
    await deleteProject(p.id);
    setProjectIcons([]);
    setLoadError(null);
    setLoadStats(null);
  };

  const handleIconContext = (e: React.MouseEvent, icon: IconItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, icon });
  };

  const handleRemoveSingle = async (iconId: string) => {
    if (!activeProjectId) return;
    removeIconFromProject(activeProjectId, iconId);
    setProjectIcons((prev) => prev.filter((i) => i.id !== iconId));
    setLoadStats((prev) => prev ? {
      ...prev,
      total: prev.total - 1,
      loaded: prev.loaded - 1,
    } : null);
    setContextMenu(null);
  };

  const renderContentArea = () => {
    if (isLoading) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin mb-3 text-neon-cyan" />
          <div className="text-sm">正在从本地数据库加载图标...</div>
          <div className="text-xs text-slate-600 mt-1">若图标较多可能需要几秒钟</div>
        </div>
      );
    }

    if (loadError && loadStats && loadStats.loaded === 0) {
      return (
        <div className="h-full flex flex-col items-center justify-center px-8 text-center">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mb-4">
            <AlertCircle className="w-8 h-8 text-rose-400" />
          </div>
          <div className="text-base font-medium text-slate-200 mb-2">加载失败</div>
          <div className="text-sm text-slate-500 max-w-md mb-5 leading-relaxed">{loadError}</div>
          <div className="flex gap-2">
            <button
              onClick={() => setLoadAttempt((n) => n + 1)}
              className="btn btn-secondary"
            >
              <RefreshCw className="w-4 h-4" />
              重试加载
            </button>
            <button
              onClick={() => inputRef.current?.click()}
              className="btn btn-primary"
            >
              <Upload className="w-4 h-4" />
              重新上传图标
            </button>
          </div>
        </div>
      );
    }

    if (filteredIcons.length === 0) {
      const isSearchEmpty = !!searchQuery.trim();
      return (
        <div
          onClick={() => !isSearchEmpty && inputRef.current?.click()}
          className={cn(
            'h-full min-h-[300px] flex flex-col items-center justify-center border-2 border-dashed rounded-xl transition-all',
            isSearchEmpty
              ? 'text-slate-600 border-ink-700 cursor-default'
              : 'text-slate-500 border-ink-600 hover:border-neon-cyan/40 hover:bg-white/[0.02] cursor-pointer'
          )}
        >
          <Upload className="w-10 h-10 mb-3 opacity-50" />
          <div className="text-sm">
            {isSearchEmpty ? '没有匹配搜索结果的图标' : '项目中暂无图标，点击上传'}
          </div>
          {loadError && loadStats && loadStats.failed > 0 && (
            <div className="mt-4 flex items-center gap-2 text-xs text-neon-amber">
              <AlertTriangle className="w-3.5 h-3.5" />
              {loadStats.failed} 个图标加载失败
              <button
                onClick={(e) => { e.stopPropagation(); loadIcons(); }}
                className="underline hover:text-neon-cyan ml-1"
              >
                重试
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
        {filteredIcons.map((icon) => (
          <div
            key={icon.id}
            onContextMenu={(e) => handleIconContext(e, icon)}
            onClick={() => toggleSelect(icon.id)}
            className={cn(
              'group relative bg-ink-800/50 border rounded-lg overflow-hidden cursor-pointer transition-all',
              selectedIconIds.has(icon.id)
                ? 'border-neon-cyan ring-1 ring-neon-cyan/50 shadow-glow-cyan'
                : 'border-ink-600 hover:border-ink-500'
            )}
          >
            {selectedIconIds.has(icon.id) && (
              <div className="absolute top-2 left-2 z-10 w-5 h-5 rounded bg-neon-cyan flex items-center justify-center">
                <Check className="w-3 h-3 text-ink-950" />
              </div>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`删除图标 "${icon.name}"?`)) {
                  handleRemoveSingle(icon.id);
                }
              }}
              className="absolute top-2 right-2 z-10 w-5 h-5 rounded bg-ink-900/80 opacity-0 group-hover:opacity-100 hover:bg-rose-600 transition-all flex items-center justify-center"
            >
              <X className="w-3 h-3 text-white" />
            </button>
            <div className="aspect-square checkerboard p-3 flex items-center justify-center">
              <img
                src={icon.dataUrl}
                alt={icon.name}
                className="max-w-full max-h-full object-contain pointer-events-none"
                draggable={false}
              />
            </div>
            <div className="px-2.5 py-2 bg-ink-900/50 border-t border-ink-700/30">
              <div className="text-[11px] text-slate-300 truncate font-mono">{icon.name}</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                {icon.width}×{icon.height}
              </div>
              {icon.tags && icon.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {icon.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan text-[9px] font-mono border border-neon-cyan/20"
                    >
                      {tag}
                      {editingIconTags === icon.id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveIconTag(icon.id, tag);
                          }}
                          className="hover:text-rose-400"
                        >
                          <XCircle className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </span>
                  ))}
                  {icon.tags.length > 3 && (
                    <span className="px-1 py-0.5 text-[9px] text-slate-500 font-mono">
                      +{icon.tags.length - 3}
                    </span>
                  )}
                </div>
              )}
              {editingIconTags === icon.id && (
                <div className="flex gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddIconTag(icon.id)}
                    placeholder="添加标签..."
                    className="flex-1 min-w-0 px-1.5 py-0.5 text-[10px] bg-ink-800 border border-ink-600 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-neon-cyan"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddIconTag(icon.id);
                    }}
                    className="px-1.5 py-0.5 text-[10px] bg-neon-cyan/20 text-neon-cyan rounded hover:bg-neon-cyan/30"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingIconTags(null);
                      setTagInput('');
                    }}
                    className="px-1.5 py-0.5 text-[10px] bg-ink-700 text-slate-400 rounded hover:bg-ink-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col" onClick={() => setContextMenu(null)}>
      <header className="shrink-0 px-6 py-4 border-b border-ink-700/50 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">图标库管理</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            按项目分组管理图标，随时追加并重新生成精灵图
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeProject && projectIcons.length > 0 && (
            <button onClick={generateFromProject} className="btn btn-primary">
              <Grid3X3 className="w-4 h-4" />
              生成精灵图 ({projectIcons.length})
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-[280px_1fr] gap-0">
        <div className="flex flex-col border-r border-ink-700/50 overflow-hidden">
          <div className="p-4 border-b border-ink-700/50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                <FolderKanban className="w-4 h-4 text-neon-cyan" />
                项目列表
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="btn-ghost btn !px-2 !py-1 text-xs"
                  title="导入项目归档"
                >
                  <PackageOpen className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setShowNewProject(true)}
                  className="btn-ghost btn !px-2 !py-1 text-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新建
                </button>
              </div>
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept=".zip,.sprite.zip"
              className="hidden"
              onChange={handleImport}
            />

            {showNewProject && (
              <div className="mb-3 p-2 bg-ink-800 rounded-lg border border-ink-600">
                <input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
                  placeholder="项目名称"
                  className="input text-xs mb-2"
                />
                <div className="flex gap-1">
                  <button onClick={handleCreateProject} className="btn btn-primary !py-1 !px-3 text-xs flex-1">
                    创建
                  </button>
                  <button
                    onClick={() => { setShowNewProject(false); setNewProjectName(''); }}
                    className="btn btn-secondary !py-1 !px-3 text-xs"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
            {projects.length === 0 ? (
              <div className="text-center py-12 text-slate-600 text-sm">
                <FolderPlus className="w-10 h-10 mx-auto mb-2 opacity-40" />
                暂无项目，点击上方新建
              </div>
            ) : (
              <div className="space-y-1">
                {projects.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setActiveProject(p.id)}
                    className={cn(
                      'group rounded-lg border cursor-pointer transition-all',
                      activeProjectId === p.id
                        ? 'bg-neon-cyan/10 border-neon-cyan/30'
                        : 'bg-ink-800/40 border-transparent hover:bg-ink-800 hover:border-ink-600'
                    )}
                  >
                    {editingId === p.id ? (
                      <div className="p-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
                          className="input text-xs"
                        />
                        <div className="flex gap-1 mt-2">
                          <button onClick={confirmRename} className="btn btn-primary !py-1 !px-2 text-xs flex-1">
                            <Check className="w-3 h-3" />
                          </button>
                          <button onClick={() => setEditingId(null)} className="btn btn-secondary !py-1 !px-2 text-xs">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 flex items-start gap-3">
                        <div className={cn(
                          'w-8 h-8 rounded-md flex items-center justify-center shrink-0',
                          activeProjectId === p.id ? 'bg-neon-cyan text-ink-950' : 'bg-ink-700 text-slate-400'
                        )}>
                          <FolderKanban className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'text-sm font-medium truncate',
                              activeProjectId === p.id ? 'text-neon-cyan' : 'text-slate-200'
                            )}>
                              {p.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                            <span className="flex items-center gap-1">
                              <ImageIcon className="w-3 h-3" />
                              {p.iconIds.length}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {formatDate(p.updatedAt).split(' ')[0]}
                            </span>
                          </div>
                        </div>
                        {activeProjectId === p.id && (
                          <ChevronRight className="w-4 h-4 text-neon-cyan shrink-0 mt-1" />
                        )}
                        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 mt-0.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); startRename(p); }}
                            className="w-6 h-6 rounded hover:bg-white/10 flex items-center justify-center text-slate-500 hover:text-slate-300"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); exportProject(p.id); }}
                            className="w-6 h-6 rounded hover:bg-neon-cyan/20 flex items-center justify-center text-slate-500 hover:text-neon-cyan"
                            title="导出项目"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteProject(p); }}
                            className="w-6 h-6 rounded hover:bg-rose-500/20 flex items-center justify-center text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden">
          {!activeProject ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-600">
              <FolderKanban className="w-16 h-16 mb-4 opacity-30" />
              <div className="text-sm">选择或创建一个项目开始管理图标</div>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-ink-700/50 flex items-center gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索图标..."
                    className="input pl-9 text-sm"
                  />
                </div>

                {loadStats && loadStats.total > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      'chip font-mono',
                      loadStats.failed > 0
                        ? 'bg-neon-amber/10 text-neon-amber border border-neon-amber/20'
                        : 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20'
                    )}>
                      {loadStats.loaded}/{loadStats.total}
                      {loadStats.failed > 0 && ` (${loadStats.failed}失败)`}
                    </span>
                    {loadStats.failed > 0 && (
                      <button
                        onClick={() => setLoadAttempt((n) => n + 1)}
                        className="btn-ghost btn !px-2 !py-1 text-xs"
                        title="重新加载"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {filteredIcons.length > 0 && (
                  <button
                    onClick={selectAll}
                    className="btn-ghost btn !px-3 !py-1.5 text-xs"
                  >
                    {selectedIconIds.size === filteredIcons.length ? '取消全选' : '全选'}
                  </button>
                )}

                {selectedIconIds.size > 0 && (
                  <>
                    <span className="chip bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20">
                      已选 {selectedIconIds.size}
                    </span>
                    <button onClick={handleExportSelected} className="btn btn-secondary !py-1.5 text-xs">
                      <Download className="w-3.5 h-3.5" />
                      导出选中
                    </button>
                    <button onClick={deleteSelected} className="btn btn-danger !py-1.5 text-xs">
                      <Trash2 className="w-3.5 h-3.5" />
                      删除
                    </button>
                  </>
                )}

                <div className="flex-1" />

                {projectIcons.length > 0 && (
                  <button onClick={handleExportProject} className="btn btn-secondary !py-1.5 text-xs mr-2">
                    <Download className="w-3.5 h-3.5" />
                    导出项目
                  </button>
                )}
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="btn btn-secondary !py-1.5 text-xs mr-2"
                >
                  <PackageOpen className="w-3.5 h-3.5" />
                  导入
                </button>
                <button
                  onClick={() => inputRef.current?.click()}
                  className="btn btn-primary !py-1.5 text-xs"
                >
                  <Upload className="w-3.5 h-3.5" />
                  添加图标
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files && handleUpload(e.target.files)}
                />
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
                {renderContentArea()}
              </div>
            </>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 card py-1 min-w-[160px] shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.icon.name);
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5 flex items-center gap-2"
          >
            <Pencil className="w-3.5 h-3.5" />
            复制名称
          </button>
          <button
            onClick={() => {
              setEditingIconTags(contextMenu.icon.id);
              setTagInput('');
              setContextMenu(null);
            }}
            className="w-full px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5 flex items-center gap-2"
          >
            <TagIcon className="w-3.5 h-3.5" />
            管理标签
          </button>
          <button
            onClick={() => {
              if (confirm(`删除图标 "${contextMenu.icon.name}"?`)) {
                handleRemoveSingle(contextMenu.icon.id);
              }
            }}
            className="w-full px-3 py-2 text-left text-xs text-rose-400 hover:bg-rose-500/10 flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5" />
            删除图标
          </button>
        </div>
      )}

      {importDialog.show && importDialog.result && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setImportDialog({ show: false, result: null })}
        >
          <div
            className="card w-full max-w-md mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center',
                importDialog.result.success
                  ? 'bg-emerald-500/10 border border-emerald-500/30'
                  : 'bg-rose-500/10 border border-rose-500/30'
              )}>
                {importDialog.result.success ? (
                  <Check className="w-5 h-5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-400" />
                )}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">
                  {importDialog.result.success ? '导入成功' : '导入失败'}
                </h3>
                {importDialog.result.migratedFrom && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    数据已从版本 {importDialog.result.migratedFrom} 迁移
                  </p>
                )}
              </div>
            </div>

            {importDialog.result.success && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 bg-ink-800 rounded-lg border border-ink-700">
                  <div className="text-xs text-slate-500">导入项目</div>
                  <div className="text-xl font-bold text-neon-cyan mt-1">
                    {importDialog.result.projects.length}
                  </div>
                </div>
                <div className="p-3 bg-ink-800 rounded-lg border border-ink-700">
                  <div className="text-xs text-slate-500">导入图标</div>
                  <div className="text-xl font-bold text-neon-cyan mt-1">
                    {importDialog.result.icons.length}
                  </div>
                </div>
              </div>
            )}

            {importDialog.result.warnings.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-medium text-neon-amber mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  警告 ({importDialog.result.warnings.length})
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1 pr-2 scrollbar-thin">
                  {importDialog.result.warnings.map((w, i) => (
                    <div key={i} className="text-[11px] text-neon-amber/80 bg-neon-amber/5 px-2 py-1 rounded font-mono">
                      {w}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {importDialog.result.errors.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-medium text-rose-400 mb-2 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  错误 ({importDialog.result.errors.length})
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1 pr-2 scrollbar-thin">
                  {importDialog.result.errors.map((e, i) => (
                    <div key={i} className="text-[11px] text-rose-400/80 bg-rose-500/5 px-2 py-1 rounded font-mono">
                      {e}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => setImportDialog({ show: false, result: null })}
                className="btn btn-primary !py-2 text-sm"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
