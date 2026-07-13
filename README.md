# Char Memory Bridge — 角色记忆桥接（SillyTavern 扩展）

把 **SillyTavern** 和你自己的**角色 bot** 共用同一份记忆库：自动注入远端记忆、从
[Horae](https://github.com/SenriYuki/SillyTavern-Horae) 一键导入剧情、面板增删改查。
所有数据走同一个后端（bot 暴露的 `/memories` HTTP API），**不绑定任何特定角色**——
填上你的 API 网址 + 密码即可。

## 你的 bot 需要提供的接口
- `GET /memories?token=XXX` → 纯文本记忆；加 `&json=1` 返回 `{memories:[{id,note,subject,category,date}]}`
- `POST /memories?token=XXX`  body `{content, subject?, category?}` → 新增
- `PATCH /memories/{id}?token=XXX` body `{content}` → 修改
- `DELETE /memories/{id}?token=XXX` → 删除
- 需允许 CORS（`Access-Control-Allow-Origin: *`）与 `OPTIONS` 预检。

## 安装
**方式一：网址安装（推荐）**
SillyTavern → Extensions → Install extension → 粘贴本仓库地址。

**方式二：手动**
把本文件夹复制到
`SillyTavern/data/<用户名>/extensions/`（新版）或
`SillyTavern/public/scripts/extensions/third-party/`（旧版），重启酒馆。

## 使用
1. 打开「扩展」设置里的 **Char Memory Bridge · 角色记忆桥接**。
2. 填 **Bot API 网址** 和 **密码**，勾选「自动注入」。
3. **测试连接** → 读到行数即成功。
4. **从 Horae 导入** → 把当前剧情事件存进共享库。
5. **刷新列表** → 看/改/删共享库里的记忆。

装好后，酒馆里的角色每次回复前会自动带上共享记忆；你的 bot 读的是同一个库。

## License
MIT
