# 项目协作规则

默认中文。先阅读 README 与 docs/superpowers/specs/2026-10-27-event-lottery-design.md。

- 抽奖、库存、作废和参与资格修改必须在活动级数据库锁保护下进行。
- 抽奖随机性仅在服务端实现；客户端动画不得改变结果。
- 抽奖请求必须幂等，重试沿用原请求 ID；修改业务规则必须添加行为测试。
- API 全部校验登录和输入；上传不信任扩展名；名单及图片不可公开。
- 不提交 .env、数据目录、真实名单和密码。
- 第一版一个管理员，活动相互隔离；不擅自加入内定中奖或付费功能。
- 验证命令：npm test、npm run typecheck、npm run build、npm run test:e2e。
- 上线前验证真实 PostgreSQL、HTTPS、备份恢复；没有验证就明确标记待验证。
