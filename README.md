# Merge Open Docs

将 VS Code 当前打开的所有文本文件合并到一个新的 Markdown Untitled 文档。

## 输出格式

每个文件生成：

````markdown
## <文件路径>

```<不带点的扩展名>
<文件当前内容>
```
````

````

例如 `.ts` 文件使用 ` ```ts `，`.cs` 使用 ` ```cs `。

## 使用

打开 Command Palette（`Ctrl+Shift+P`），执行：

```text
Merge Open Docs: 合并所有打开文档          Ctrl+Alt+M
Merge Open Docs: 合并所有打开文档并压缩    Ctrl+Alt+Shift+M
````

两个命令也可以在编辑器 Tab 右键菜单中找到。

压缩版本只做安全空行压缩：连续空行压缩为一个、去掉文件首尾空行；缩进、字符串、注释、非空行内容完全不变。

### 合并选中文件/目录

在 VS Code Explorer 中：

1. 右键一个文件或目录，或按住 `Ctrl` 多选（文件与文件夹可混选）
2. 选择 `Merge Open Docs: 合并选中的文件/目录`（或 `...并压缩`）
3. 扩展递归读取所选文件夹中的文本文件，散选文件直接读取
4. 按过滤规则跳过依赖目录、点文件与二进制文件
5. 生成新的 Untitled 文档

嵌套选中自动去重（同时选了父目录和其中的文件不会重复）。文件标题统一显示相对于 workspace 根目录的路径（无工作区时显示绝对路径）；文件按路径稳定排序；已在编辑器中打开的文件优先使用内存中的未保存内容；单文件超过 2 MB 自动跳过；过滤配置对文件夹递归与散选文件同样生效，"合并所有打开文档"不受影响。

### 目录过滤

默认情况下，目录模式会过滤：

```text
node_modules
logs
dist
```

同时过滤：

```text
以 "." 开头的目录（如 .git、.vscode）
```

以及：

```text
*.min.* 文件（如 jquery.min.js、index.min.css）
```

同时过滤：

```text
以 "." 开头的文件
```

以及：

```text
非文本文件（按扩展名快速排除 + 读取内容检测 NUL 字节）
```

默认不排除 `bin`、`obj` 等目录，如需排除请自行配置。

### 自定义过滤目录

在 `.vscode/settings.json`：

```json
{
  "mergeOpenDocs.excludeDirectories": ["node_modules", "logs", "bin", "obj", ".git"]
}
```

目录按名称匹配（不是路径），不区分大小写，任意层级生效。

### 自定义过滤文件

```json
{
  "mergeOpenDocs.excludeFiles": ["*.generated.cs", "*.Designer.cs", "*.min.js", "appsettings.Local.json"]
}
```

按文件名匹配，不区分大小写，支持：

```text
*  任意数量字符
?  单个字符
```

注意：自定义 `excludeFiles` 会整体替换默认值 `*.min.*`，如仍需过滤压缩文件请一并写入。

### 是否过滤点文件

默认：

```json
{
  "mergeOpenDocs.excludeDotFiles": true
}
```

如果需要包含：

```text
.gitignore
.env
.editorconfig
```

可以设置：

```json
{
  "mergeOpenDocs.excludeDotFiles": false
}
```

配置修改后立即生效，无需重启。压缩模式只进行安全的空行压缩，不进行语言级代码 minify。

## 特性

- 支持多个 Tab Group；
- 自动去重；
- 支持 Diff，Diff 使用 modified 一侧；
- 保留未保存修改；
- 输出为 Markdown，代码用带语言标识的围栏包裹；
- 多次执行不会把上次生成的 Untitled 结果文档再合并进去；
- 不修改原始文件；
- 不保存原始文件；
- 不创建临时文件；
- 不需要网络；
- 不需要第三方 runtime dependency。

## 打包安装

```powershell
npm install -g @vscode/vsce
git clone https://github.com/nbaxp/merge-open-docs.git
cd merge-open-docs
vsce package
```

生成 `merge-open-docs-0.1.3.vsix`，在 VS Code 中选择 `Extensions: Install from VSIX...` 安装。

命令行安装 `code --install-extension merge-open-docs.vsix`
