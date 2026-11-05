# Changelog

## 0.1.3（当前版本）

- 提供 4 个命令：
  - `Merge Open Docs: 合并所有打开文档`
  - `Merge Open Docs: 合并所有打开文档并压缩`
  - `Merge Open Docs: 合并选中的文件/目录`
  - `Merge Open Docs: 合并选中的文件/目录并压缩`
- 快捷键：`Ctrl+Alt+M` 合并所有打开文档，`Ctrl+Alt+Shift+M` 合并并压缩。
- 菜单：编辑器标题右键菜单（`editor/title/context`）与资源管理器右键菜单（`explorer/context`）。
- 3 个配置项：`mergeOpenDocs.excludeDirectories`、`mergeOpenDocs.excludeFiles`、`mergeOpenDocs.excludeDotFiles`。
- 「压缩」仅折叠连续空行并去除文件首尾空行，不是 gzip，也不是语言级 minify；缩进、字符串、注释与非空行内容不变。

## 更早版本

仓库中没有更早版本的变更记录，因此不列出历史条目。
