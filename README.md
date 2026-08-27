# P-Spider

![操作系统](https://img.shields.io/badge/%E6%93%8D%E4%BD%9C%E7%B3%BB%E7%BB%9F-Windows-yellow)

一个推特媒体（图片、视频）下载器。

> **本项目为 [X-Spider](https://github.com/MiningCattiva/x-spider) 的修改版（fork）**，在原版基础上新增订阅、统计、时间流等功能。原版版权归其原作者所有，本项目遵循 GPL-3.0 许可证。

## 新增功能

- **订阅自动追更**：给账号添加订阅，设置刷新间隔（默认 12 小时），自动检查并下载新推文媒体
- **一键刷新**：手动触发所有订阅立即检查
- **订阅管理**：按账号独立编辑媒体类型、刷新间隔；导出/导入订阅列表（JSON）
- **统计**：按日期查看订阅新增下载量（数量 + 大小）柱状图，订阅下载排行
- **时间流**：近 7 天下载记录按推文时间倒序浏览，缩略图 + 原图预览
- **开机自启动**：开机自动运行，方便订阅自动检查
- **关闭行为**：点击 X 可选择最小化到托盘或退出，托盘图标常驻
- **下载历史**：自动记录每次下载的推文、时间、文件，作为时间流数据源

## 下载

[Releases](https://github.com/mdo730/P-spider/releases/latest)

## 功能

- 媒体过滤器（如指定下载日期范围）
- 跳过已下载文件
- 可配置文件名、保存路径格式
- 手动、自动代理
- Cookie 登录

## 软件截图

![screenshot-homepage](./assets/screenshot-homepage.jpg)

![screenshot-settings](./assets/screenshot-settings.jpg)

![screenshot-downloading](./assets/screenshot-downloading.jpg)

## 致谢

本项目基于 [X-Spider](https://github.com/MiningCattiva/x-spider) 修改开发（fork）。

- **原版仓库**：[MiningCattiva/x-spider](https://github.com/MiningCattiva/x-spider)
- **原版作者**：[MiningCattiva](https://github.com/MiningCattiva)
- **开源协议**：GPL-3.0（与 X-Spider 一致），保留原 LICENSE