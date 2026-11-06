# jlc-erp-mcp

嘉立创云ERP（JLC SaaS ERP）MCP Server —— 用自然语言查询云ERP数据。**只读**，20 个查询工具。

## 接入方式（MCP 客户端 / WorkBuddy 连接器）

密钥从环境变量注入：`JLC_ERP_APP_ID` / `JLC_ERP_ACCESS_KEY` / `JLC_ERP_SECRET_KEY`

获取方式：嘉立创开放平台（https://open.jlc.com）建应用 → 应用详情「密钥管理」复制三元组。

### stdio 配置示例

```json
{
  "mcpServers": {
    "jlc-erp-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:tzgj4r2kjd-commits/jlc-erp-mcp"],
      "env": {
        "JLC_ERP_APP_ID": "你的AppID",
        "JLC_ERP_ACCESS_KEY": "你的AccessKey",
        "JLC_ERP_SECRET_KEY": "你的SecretKey"
      }
    }
  }
}
```

## 工具清单（20，全只读）

- **任务项目**：query_projects / query_project_members / query_tasks / query_task_detail / query_work_hours / query_work_hour_detail / query_task_attachments
- **物料成品**：query_material_stock / query_materials / query_material_category_tree / query_goods_stock / query_goods / query_goods_category_tree
- **仓库**：query_warehouse_tree / query_warehouses / query_warehouse_locations
- **单据**：query_in_stock_orders / query_out_stock_orders / query_orders（采购+生产+销售三合一）
- **文件**：query_file_tags

## 安全说明

- 本服务不含任何写操作；密钥只从环境变量读取，不落盘、不外传
- 每接口限流 1000 次/天（开放平台侧限制）
- 状态枚举口径：任务 1未开始 4进行中 2已完成 3取消 5任务封档

## 已知环境问题

- 若你的 npm registry 指向公司私有源（如 nexus），`npx -y github:...` 可能拉包失败/卡住。解决：`npm config get registry` 确认后临时切公网源 `npm config set registry https://registry.npmjs.org`，或先 clone 本仓库手动 `npm install` 后把 command 指向本地 server.js
