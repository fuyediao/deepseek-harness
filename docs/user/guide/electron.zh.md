# 使用桌面应用

[English](electron.md) | 中文

请先按照[根目录 README](../../../README.zh.md#run) 中的说明，用 `dsh electron`（或 `dsh --profile electron`）启动 GeoCRM 桌面应用，或直接打开已安装的 Windows 应用。本指南从窗口已经打开的状态开始。Host 会把启动时所在的目录作为默认文件系统位置；全新窗口则不会选中任何工作区，你需要添加一个工作区。已安装的 exe 会自行启动该 Host；`dsh electron` 仍是源码树启动方式。

桌面应用使用与 [Web UI](./index.zh.md) 相同的会话视图、模型设置和会话历史。它不开放任何网络端口：窗口通过本机 IPC socket 与 Host 通信，因此没有可复制或分享的 URL。

## 登录

窗口会先打开 GeoCRM 登录页。标题栏和侧栏显示 GeoCRM。请先用工号或邮箱登录，然后才能使用会话界面。在调用目录的 `.env` 里写 GeoCRM API 源站：`GEOCRM_BASE_URL=https://api.example.com` 或 `GEOCRM_DEPLOYMENT_DOMAIN=example.com`（与 GeoCRM Electron 的 `VITE_DEPLOYMENT_DOMAIN` 使用同一主机名）。没有该文件时保持 `http://127.0.0.1:3001`。已存储的 `GEOCRM_HARNESS_TOKEN` 会跳过该页。账号需要 `desktop_agent`。从**设置 → 模型**退出登录会回到该页。供应商 API 密钥留在 GeoCRM 设置中。密码登录会保持会话；Host 会在访问 JWT 过期前刷新。`geocrm` 路由与 GeoCRM CRM 工具会立即可用，不需要重启应用。

[模型配置指南](./providers.zh.md)介绍 Web UI 的 DeepSeek 卡片以及自定义 OpenAI 兼容端点。

## 选择工作区

点击**选择工作区**，添加启动 `dsh` 时所在的项目目录，然后选中它。选中工作区前，会话输入框不可用。

## 运行任务

启动一个会话并发送：

> Summarize this repository and identify its main packages.

Agent（智能体）可以读取和编辑工作区文件、运行命令、委派工作并维护计划。如果根据当前权限策略，某项操作需要审批，桌面应用会先询问你。

## 继续使用

- [配置模型](./providers.zh.md)
- [使用 Web UI](./index.zh.md)
- [使用其他 CLI 模式](../../../apps/cli/README.zh.md)
- [开发插件](../develop/basic/index.zh.md)
