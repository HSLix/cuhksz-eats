# CUHKSZ Eats

CUHKSZ Eats 是由学生个人维护的校园餐饮信息静态网站。内容来自维护者本地的 `images/` 图片目录；源图片不会提交到 Git。

## 环境要求

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)
- Node.js 20+

从全新检出安装锁定的 Python 与前端依赖：

```bash
uv sync --frozen
npm install
```

## 本地维护

检查默认的 `images/` 源目录，不改名、移动或写入任何源图片：

```bash
uv run python manage.py check
```

检查结果分为两类：

- `错误` 会阻止预览和发布门禁；包括非法目录层级、不支持或损坏的图片、同一归属内的源前缀重名，以及无效的结构化文件名或菜品价格。
- `警告` 会给出修正示例但允许继续；包括无法解析拍摄时间、疑似旧命名、疑似结构化内容和名称首尾空格。

每条诊断都会指出具体路径、原因和手工修正示例。命令只报告问题，不会交互询问，也不会自动移动、重命名或修改源文件。图片扩展名不区分大小写，支持 JPEG、PNG、WebP、HEIC 和 HEIF；`.DS_Store`、`Thumbs.db`、`desktop.ini` 与 AppleDouble 文件会被忽略。

通过同一检查后生成一次性本地内容，并启动 Vue/Vite 预览：

```bash
uv run python manage.py dev
```

默认地址是 `http://127.0.0.1:5173`。一次性产物写入被 Git 忽略的 `.generated/`，可随时删除重建。

预览会严格按目录归属展示内容：第一层目录是餐饮地点，第二层目录是档口；餐饮地点内散图不会被猜测归入档口。精确命名为 `菜单` 和 `门面` 的照片单独成组。地点级菜品散图始终展示；当地点同时含有档口时，散图上方显示“未归档”标题。根目录散图及 `_校园补充/` 下的相册只出现在首页次要的校园补充区域。

`publish` 目前已经接入与 `check`、`dev` 完全相同的前置检查；实际生成和更新 GitHub Pages 的发布阶段将在 Issue #10 实现。在此之前，校验通过后该命令会明确退出，不修改发布分支或远程站点：

```bash
uv run python manage.py publish
```

## 验收

安装 Playwright 的 Chromium 后运行完整的公开命令与浏览器验收：

```bash
npx playwright install chromium
npm run test:e2e
```
