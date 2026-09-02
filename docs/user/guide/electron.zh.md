# 使用桌面应用

[English](electron.md) | 中文

请先按照[根目录 README](../../../README.zh.md#run) 中的说明，用 `dsh electron`（或 `dsh --profile electron`）启动桌面应用，或直接打开已安装的 Windows 应用。本指南从窗口已经打开的状态开始。Host 会把启动时所在的目录作为默认文件系统位置；全新窗口则不会选中任何工作区，你需要添加一个工作区。已安装的 exe 会自行启动该 Host；`dsh electron` 仍是源码树启动方式。

桌面应用使用与 [Web UI](./index.zh.md) 相同的会话视图、模型设置和会话历史。它不开放任何网络端口：窗口通过本机 IPC socket 与 Host 通信，因此没有可复制或分享的 URL。

## 配置模型

打开**设置 → 模型**，输入 [DeepSeek API 密钥](https://platform.deepseek.com/)并保存。模型路由会立即可用，不需要重启应用。

[模型配置指南](./providers.zh.md)介绍其他提供方和自定义 OpenAI 兼容端点。

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
