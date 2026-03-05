# X 互关检测器 (X Mutual Follow Checker)

一个 Chrome 浏览器插件，帮你快速找出 X (Twitter) 关注列表中**没有回关你**的账号，并支持勾选后一键取关。

![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## ✨ 功能特点

- 🔍 **互关检测**：自动扫描 `/following` 页面，识别哪些人没有回关你
- 📋 **结果弹窗**：扫描完成后弹出未回关用户列表，含头像、用户名、handle、简介
- ☑️ **批量勾选**：支持全选 / 单选，灵活决定要取关的对象
- 🗑️ **一键取关**：模拟真实鼠标点击行为，规避平台风控
- ⚙️ **扫描条数设置**：可自定义扫描数量，或勾选「全部」无限扫描
- 🖼️ **悬浮面板**：固定在页面右下角，不遮挡内容，可折叠

---

## 🚀 安装方法（开发者模式）

> Chrome Web Store 审核中，目前请手动安装。

1. 下载本仓库（Clone 或 Download ZIP）
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角「**开发者模式**」
4. 点击「**加载已解压的扩展程序**」
5. 选择本项目文件夹

---

## 📖 使用方法

1. 打开 X，进入你的**关注列表**页面（`x.com/你的用户名/following`）
2. 页面右下角会出现悬浮面板 **🔍 互关检测**
3. 设置扫描条数（或勾选「全部」）
4. 点击「**🔍 互关检查**」按钮
5. 等待自动滚动加载完成后，弹窗展示未回关用户
6. 勾选要取关的账号，点击「**🗑️ 一键取关已选**」

---

## 🔧 技术实现

- **无需 API**：直接解析页面 DOM，检测 `userFollowIndicator` 标识判断是否互关
- **虚拟滚动适配**：X 使用虚拟滚动，插件在每次滚动后立即解析并去重，确保数据完整
- **仿人操作**：取关时模拟 `mouseover / mousedown / click` 事件链，避免触发风控
- **范围限定**：仅在 `primaryColumn` 内查找用户卡片，不误抓侧边推荐用户

---

## 📁 文件结构

```
x-mutual-follow-checker/
├── manifest.json      # Chrome 插件配置（Manifest V3）
├── content.js         # 核心逻辑：检测、滚动采集、取关
├── content.css        # 悬浮面板 & 弹窗样式
├── popup.html         # 插件 Popup 页面
├── popup.js           # Popup 逻辑
└── icons/             # 插件图标
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## ⚠️ 注意事项

- 仅适用于 `x.com` 和 `twitter.com`
- 取关操作有随机延迟（2~5 秒/次），模拟人工节奏，请耐心等待
- 批量取关数量过大时建议分批操作，避免账号异常
- 本插件不会收集或上传任何用户数据

---

## 🤝 贡献

欢迎提交 Issue 和 PR！

---

## 📄 License

[MIT](./LICENSE)
