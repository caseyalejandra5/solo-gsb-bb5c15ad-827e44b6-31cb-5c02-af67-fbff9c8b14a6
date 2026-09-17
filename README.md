# 字幕时间轴修复器

本地运行的字幕时间轴修复工具（React + TypeScript + Vite）。导入 SRT 字幕与本地视频后，可在播放器下方的时间轴上直接拖动字幕块调整起止时间，实时检测时间重叠、起止倒置、时长过短等问题，修复完成后导出标准 SRT。

## 功能

- 📄 **导入 SRT / 本地视频**：视频仅通过 `URL.createObjectURL` 在本地播放，不上传任何数据
- 🧱 **时间轴编辑**：播放器下方按时间轴展示字幕块
  - 拖动块体：整体平移该条字幕
  - 拖动左右两端手柄：分别调整开始 / 结束时间
  - 点击标尺或轨道空白处：移动播放头并联动视频跳转
  - 双击字幕块：跳转到该字幕开始时间
- 🔗 **连锁移动**：开启后，平移某条字幕时其后所有字幕保持相对间隔同步平移
- 🚦 **实时问题检测**（字幕块与右侧面板同步高亮）
  - 红色：时间重叠
  - 紫色（斜纹）：起止倒置（结束 ≤ 开始）
  - 黄色：时长短于 500ms
- ↶↷ **撤销 / 重做**：拖动、删除等操作均可回退
- 💾 **导出修复后的 SRT**：按开始时间排序并重新编号

## 快速开始（Docker，单条命令）

```bash
docker compose up --build
```

启动后在浏览器访问：

> **http://localhost:8080**

（容器内 Nginx 监听 80 端口，Compose 映射到宿主机 **8080** 端口；如需修改，调整 `docker-compose.yml` 中的 `ports`。）

停止服务：

```bash
docker compose down
```

## 本地开发

```bash
npm install
npm run dev
```

开发服务器地址：**http://localhost:5173**

其他命令：

```bash
npm run build    # 类型检查并产出 dist/
npm run preview  # 预览生产构建（http://localhost:4173）
```

## 使用说明

1. 点击 **导入 SRT** 选择字幕文件（或先点 **加载示例** 体验，示例故意包含三类问题）。
2. 点击 **导入视频** 关联本地视频（可选，不导入也能编辑时间轴）。
3. 在时间轴上拖动字幕块或其两端手柄修复问题；右侧「问题检测」面板实时刷新，点击条目可跳转定位。
4. 需要整体后移/前移某段字幕时，打开 **连锁移动** 再拖动即可。
5. 修复完成后点击 **导出修复后 SRT** 下载文件（文件名自动加 `.fixed` 后缀）。

### 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl / Cmd + Z` | 撤销 |
| `Ctrl / Cmd + Shift + Z` 或 `Ctrl + Y` | 重做 |
| `Delete` / `Backspace` | 删除选中的字幕块 |

## 项目结构

```
├── Dockerfile              # 多阶段构建：node 构建 → nginx 托管
├── docker-compose.yml      # 单条命令启动，映射 8080:80
├── nginx.conf              # SPA 回退与静态资源缓存
├── index.html
├── package.json
├── vite.config.ts
└── src
    ├── App.tsx             # 主状态、撤销/重做历史栈、导入导出
    ├── srt.ts              # SRT 解析 / 序列化 / 时间戳格式化
    ├── issues.ts           # 重叠、倒置、过短（<500ms）实时检测
    ├── sample.ts           # 内置示例字幕
    └── components
        ├── Toolbar.tsx     # 导入/导出、撤销重做、连锁移动、缩放
        ├── VideoPlayer.tsx # 本地视频播放器
        ├── Timeline.tsx    # 时间轴：拖动/缩放手柄、标尺、播放头
        └── IssuesPanel.tsx # 问题列表面板
```
