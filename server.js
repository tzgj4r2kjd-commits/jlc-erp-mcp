#!/usr/bin/env node
// jlc-erp-mcp v1.0.0 —— 嘉立创云ERP MCP Server（stdio，只读查询）
// 密钥经环境变量注入：JLC_ERP_APP_ID / JLC_ERP_ACCESS_KEY / JLC_ERP_SECRET_KEY
// 获取方式：嘉立创开放平台 https://open.jlc.com 建应用后到「应用详情-密钥管理」复制
// 覆盖 20 个只读查询工具：项目任务/工时/物料成品库存/仓库库位/采购生产销售订单/附件标签
// 写类接口（创建修改任务、确认出入库等）不在本服务内，请到云ERP网页端操作
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "node:crypto";
import https from "node:https";

const APP_ID = process.env.JLC_ERP_APP_ID;
const ACCESS_KEY = process.env.JLC_ERP_ACCESS_KEY;
const SECRET_KEY = process.env.JLC_ERP_SECRET_KEY;
if (!APP_ID || !ACCESS_KEY || !SECRET_KEY) {
  console.error("缺少环境变量 JLC_ERP_APP_ID / JLC_ERP_ACCESS_KEY / JLC_ERP_SECRET_KEY（嘉立创开放平台应用密钥）");
  process.exit(1);
}
const creds = { appId: APP_ID, accessKey: ACCESS_KEY, secretKey: SECRET_KEY };

function jopCall(apiPath, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const nonce = crypto.randomBytes(16).toString("hex");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const stringToSign = "POST\n" + apiPath + "\n" + timestamp + "\n" + nonce + "\n" + postData + "\n";
    const signature = crypto.createHmac("sha256", creds.secretKey).update(stringToSign).digest("base64");
    const auth = 'JOP appid="' + creds.appId + '",accesskey="' + creds.accessKey + '",timestamp="' + timestamp + '",nonce="' + nonce + '",signature="' + signature + '"';
    const req = https.request({
      hostname: "open-api.jlc.com", path: apiPath, method: "POST",
      headers: { "Content-Type": "application/json; utf-8", "Authorization": auth, "Content-Length": Buffer.byteLength(postData) },
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("BAD_JSON " + data.slice(0, 100))); } });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

const STATUS_MAP = { 1: "未开始", 2: "已完成", 3: "取消", 4: "进行中", 5: "任务封档" };
function fmtPage(r, maxShow = 15) {
  if (!r || r.success === false) return "调用失败: " + JSON.stringify(r).slice(0, 400);
  const d = r.data || {};
  const list = d.data || d.list || (Array.isArray(d) ? d : []);
  const total = d.total != null ? d.total : (d.totalRows != null ? d.totalRows : list.length);
  return "共 " + total + " 条（显示前 " + Math.min(list.length, maxShow) + "）\n" + JSON.stringify(list.slice(0, maxShow), null, 1).slice(0, 5000);
}
function fmtTree(r) {
  if (!r || r.success === false) return "调用失败: " + JSON.stringify(r).slice(0, 400);
  return JSON.stringify(r.data, null, 1).slice(0, 5000);
}

const server = new McpServer({ name: "jlc-erp-mcp", version: "1.0.0" });
const T = (name, cfg, fn) => server.registerTool(name, cfg, fn);
const call = jopCall;
const pn = (p) => p.pageNum || 1;
const ps = (p, d) => p.pageSize || d || 20;

// ── 任务与项目 ──
T("query_projects", {
  title: "查询项目列表", description: "分页查询云ERP项目列表（只读）。状态：1待启动 2研发中 3已结项 4已取消 5待排期。",
  inputSchema: {
    projectName: z.string().describe("项目名称").optional(),
    keyword: z.string().describe("关键字").optional(),
    projectStatus: z.number().int().describe("1待启动 2研发中 3已结项 4已取消 5待排期").optional(),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认20").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtPage(await call("/open/api/saas/erp/project/page", { pageNum: pn(p), pageSize: ps(p), projectName: p.projectName, keyword: p.keyword, projectStatus: p.projectStatus })) }] }));

T("query_project_members", {
  title: "查询项目成员", description: "按项目id查成员详情（只读）：总数+列表（姓名/岗位/角色）。项目id先用 query_projects 查。",
  inputSchema: { projectId: z.number().int().describe("项目id（必填）") },
}, async (p) => {
  const r = await call("/open/api/saas/erp/project/memberDetailInProject", { projectId: p.projectId });
  return { content: [{ type: "text", text: r.success !== false ? "成员总数 " + (r.data && r.data.count) + "\n" + JSON.stringify(r.data && r.data.memberList, null, 1).slice(0, 4000) : "调用失败: " + JSON.stringify(r).slice(0, 300) }] };
});

T("query_tasks", {
  title: "查询项目任务", description: "分页查询云ERP项目任务（只读）。状态口径：1未开始 4进行中 2已完成 3取消 5任务封档。项目id可先用 query_projects 查。",
  inputSchema: {
    projectId: z.number().int().describe("项目id（推荐传）").optional(),
    taskCode: z.string().describe("任务编码精确匹配，如 TASK5555").optional(),
    taskName: z.string().describe("任务名称关键字").optional(),
    taskStatusList: z.array(z.number().int()).describe("状态多选").optional(),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认20").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtPage(await call("/open/api/saas/erp/projectTask/page", { pageNum: pn(p), pageSize: ps(p), projectId: p.projectId, taskCode: p.taskCode, taskName: p.taskName, taskStatusList: p.taskStatusList })) }] }));

T("query_task_detail", {
  title: "查询任务详情", description: "按任务编码或id查单个任务完整详情：描述/负责人/工时/时间/风险（只读）。",
  inputSchema: {
    taskCode: z.string().describe("任务编码，与taskId二选一").optional(),
    taskId: z.number().int().describe("任务id，与taskCode二选一").optional(),
  },
}, async (p) => {
  if (!p.taskCode && !p.taskId) return { content: [{ type: "text", text: "请提供 taskCode 或 taskId 之一" }] };
  const r = await call("/open/api/saas/erp/projectTask/detail", { taskCode: p.taskCode, taskId: p.taskId });
  return { content: [{ type: "text", text: r.success !== false ? JSON.stringify(r.data, null, 1).slice(0, 4000) : "查询失败: " + JSON.stringify(r).slice(0, 300) }] };
});

T("query_work_hours", {
  title: "查询项目工时", description: "按任务查工时记录（只读）。taskId 必填（服务端强制），可用 query_tasks 获取。",
  inputSchema: {
    taskId: z.number().int().describe("任务id（必填）"),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认50").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtPage(await call("/open/api/saas/erp/projectTaskWorkingHours/page", { taskId: p.taskId, pageNum: pn(p), pageSize: ps(p, 50) })) }] }));

T("query_work_hour_detail", {
  title: "查询工时详情", description: "按工时记录id查单条详情（只读）。",
  inputSchema: { projectTaskWorkingHoursId: z.number().int().describe("工时记录id（必填）") },
}, async (p) => {
  const r = await call("/open/api/saas/erp/projectTaskWorkingHours/detail", { projectTaskWorkingHoursId: p.projectTaskWorkingHoursId });
  return { content: [{ type: "text", text: r.success !== false ? JSON.stringify(r.data, null, 1).slice(0, 3000) : "调用失败: " + JSON.stringify(r).slice(0, 300) }] };
});

T("query_task_attachments", {
  title: "查询任务附件", description: "按任务id查附件列表（只读）：文件名/大小/上传时间/上传人。",
  inputSchema: { taskBizKey: z.number().int().describe("任务id（必填）") },
}, async (p) => {
  const r = await call("/open/api/saas/erp/file/listTaskAttachment", { taskBizKey: p.taskBizKey });
  return { content: [{ type: "text", text: r.success !== false ? JSON.stringify(r.data, null, 1).slice(0, 4000) : "调用失败: " + JSON.stringify(r).slice(0, 300) }] };
});

// ── 物料/成品/库存 ──
T("query_material_stock", {
  title: "查询物料库存", description: "分页查物料库存（只读）：库存/SMT占用/云ERP占用/成本。stockNumStatus：1有库存 2已达预警 3已删除。",
  inputSchema: {
    keyWordSearch: z.string().describe("关键字").optional(),
    materialCode: z.string().describe("物料编码").optional(),
    materialName: z.string().describe("物料名称").optional(),
    warehouseId: z.number().int().describe("仓库id").optional(),
    biggerThanZero: z.boolean().describe("true=只看库存>0").optional(),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认20").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtPage(await call("/open/api/saas/erp/inventory/stock/material/menuPage", { pageNum: pn(p), pageSize: ps(p), keyWordSearch: p.keyWordSearch, materialCode: p.materialCode, materialName: p.materialName, warehouseId: p.warehouseId, biggerThanZero: p.biggerThanZero })) }] }));

T("query_materials", {
  title: "查询物料档案", description: "分页查进销存物料主数据（只读）：单价/规格/封装/库存。区别于 query_material_stock（仓库维度展开）。",
  inputSchema: {
    keywordSearch: z.string().describe("关键字").optional(),
    materialCode: z.string().describe("物料编号").optional(),
    materialName: z.string().describe("物料名称").optional(),
    specification: z.string().describe("规格").optional(),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认20").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtPage(await call("/open/api/saas/erp/inventory/material/page", { pageNum: pn(p), pageSize: ps(p), keywordSearch: p.keywordSearch, materialCode: p.materialCode, materialName: p.materialName, specification: p.specification })) }] }));

T("query_material_category_tree", {
  title: "查询物料类别树", description: "查物料类别类型树V2（只读）。materialType：1基础物料 2半成品。",
  inputSchema: {
    materialType: z.number().int().describe("1基础物料 2半成品").optional(),
    materialCategoryName: z.string().describe("类别名称").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtTree(await call("/open/api/saas/erp/inventory/materialCategory/typeTreeV2", { materialType: p.materialType, materialCategoryName: p.materialCategoryName })) }] }));

T("query_goods_stock", {
  title: "查询成品库存", description: "分页查成品库存（只读）：在库/占用/可用库存、成本、BOM总价。",
  inputSchema: {
    keyWordSearch: z.string().describe("关键字").optional(),
    goodsCode: z.string().describe("商品编号").optional(),
    goodsName: z.string().describe("商品名称").optional(),
    warehouseId: z.number().int().describe("仓库id").optional(),
    biggerThanZero: z.boolean().describe("true=只看库存>0").optional(),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认20").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtPage(await call("/open/api/saas/erp/inventory/stock/goods/menuPage", { pageNum: pn(p), pageSize: ps(p), keyWordSearch: p.keyWordSearch, goodsCode: p.goodsCode, goodsName: p.goodsName, warehouseId: p.warehouseId, biggerThanZero: p.biggerThanZero })) }] }));

T("query_goods", {
  title: "查询成品档案", description: "分页查成品主数据（只读）：编码/名称/规格/库存三口径/BOM。",
  inputSchema: {
    keyword: z.string().describe("关键字").optional(),
    goodsName: z.string().describe("成品名称").optional(),
    spec: z.string().describe("规格型号").optional(),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认20").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtPage(await call("/open/api/saas/erp/goods/page", { pageNum: pn(p), pageSize: ps(p), keyword: p.keyword, goodsName: p.goodsName, spec: p.spec })) }] }));

T("query_goods_category_tree", {
  title: "查询成品目录树", description: "查成品目录树/商品分类（只读）。",
  inputSchema: {
    goodsConfigType: z.number().int().describe("1商品单位 2商品分类，默认2").optional(),
    keyword: z.string().describe("关键字").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtTree(await call("/open/api/saas/erp/goods/config/tree", { goodsConfigType: p.goodsConfigType || 2, keyword: p.keyword })) }] }));

// ── 仓库 ──
T("query_warehouse_tree", {
  title: "查询仓库货架库位树", description: "查仓库-货架-库位三级树（只读，零参数可用）。仓库/货架/库位id权威来源。",
  inputSchema: { warehouseId: z.number().int().describe("只看某仓库").optional() },
}, async (p) => ({ content: [{ type: "text", text: fmtTree(await call("/open/api/saas/erp/warehouse/warehouseLocationTreeV2", { warehouseId: p.warehouseId })) }] }));

T("query_warehouses", {
  title: "分页查询仓库", description: "分页查仓库列表（只读）。类型：1仓库 2嘉立创SMT私有库。",
  inputSchema: {
    warehouseName: z.string().describe("仓库名称").optional(),
    warehouseCode: z.string().describe("仓库编号").optional(),
    warehouseType: z.number().int().describe("1仓库 2SMT私有库").optional(),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认20").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtPage(await call("/open/api/saas/erp/warehouse/menuPage", { pageNum: pn(p), pageSize: ps(p), warehouseName: p.warehouseName, warehouseCode: p.warehouseCode, warehouseType: p.warehouseType })) }] }));

T("query_warehouse_locations", {
  title: "分页查询库位", description: "分页查库位（只读），可按仓库/货架id过滤。",
  inputSchema: {
    keyword: z.string().describe("关键字").optional(),
    warehouseId: z.number().int().describe("仓库id").optional(),
    shelfId: z.number().int().describe("货架id").optional(),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认20").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtPage(await call("/open/api/saas/erp/warehouse/warehouseLocationPage", { pageNum: pn(p), pageSize: ps(p), keyword: p.keyword, warehouseId: p.warehouseId, shelfId: p.shelfId })) }] }));

// ── 单据 ──
T("query_in_stock_orders", {
  title: "查询入库单", description: "分页查入库单（只读）。类型：1采购 2生产完工 3成品盘盈 4原料盘盈 5退料 6/7其他 8调拨 9借调 10调整 11销售退货 12发货退货。",
  inputSchema: {
    inStockCode: z.string().describe("入库单号").optional(),
    materialCode: z.string().describe("物料编号").optional(),
    materialName: z.string().describe("物料名称").optional(),
    goodsCode: z.string().describe("成品编号").optional(),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认20").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtPage(await call("/open/api/saas/erp/inventory/inStock/page", { pageNum: pn(p), pageSize: ps(p), inStockCode: p.inStockCode, materialCode: p.materialCode, materialName: p.materialName, goodsCode: p.goodsCode })) }] }));

T("query_out_stock_orders", {
  title: "查询出库单", description: "分页查出库单（只读）。",
  inputSchema: {
    outStockCode: z.string().describe("出库单号").optional(),
    materialCode: z.string().describe("物料编号").optional(),
    goodsCode: z.string().describe("成品编号").optional(),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认20").optional(),
  },
}, async (p) => ({ content: [{ type: "text", text: fmtPage(await call("/open/api/saas/erp/inventory/outStock/page", { pageNum: pn(p), pageSize: ps(p), outStockCode: p.outStockCode, materialCode: p.materialCode, goodsCode: p.goodsCode })) }] }));

T("query_orders", {
  title: "查询采购/生产/销售订单", description: "统一查询三类订单（只读）。orderType：purchase采购 production生产 sales销售。传detailId查详情；不传则分页查列表。",
  inputSchema: {
    orderType: z.enum(["purchase", "production", "sales"]).describe("订单类型（必填）"),
    detailId: z.number().int().describe("传则查该单详情").optional(),
    code: z.string().describe("单号筛选").optional(),
    pageNum: z.number().int().min(1).describe("页码，默认1").optional(),
    pageSize: z.number().int().min(1).max(1000).describe("每页条数，默认20").optional(),
  },
}, async (p) => {
  let r;
  if (p.detailId) {
    if (p.orderType === "purchase") r = await call("/open/api/saas/erp/purchaseOrder/detail", { purchaseOrderId: p.detailId });
    else if (p.orderType === "production") r = await call("/open/api/saas/erp/productionOrder/detail", { productionOrderId: p.detailId });
    else r = await call("/open/api/saas/erp/order/detail", { orderId: p.detailId });
    return { content: [{ type: "text", text: r.success !== false ? JSON.stringify(r.data || r, null, 1).slice(0, 6000) : "调用失败: " + JSON.stringify(r).slice(0, 300) }] };
  }
  if (p.orderType === "purchase") r = await call("/open/api/saas/erp/purchaseOrder/menuPage", { pageNum: pn(p), pageSize: ps(p), purchaseOrderCode: p.code });
  else if (p.orderType === "production") r = await call("/open/api/saas/erp/productionOrder/menuPage", { pageNum: pn(p), pageSize: ps(p), productionOrderCode: p.code });
  else r = await call("/open/api/saas/erp/order/menuPage", { pageNum: pn(p), pageSize: ps(p), orderCode: p.code });
  return { content: [{ type: "text", text: fmtPage(r) }] };
});

// ── 文件 ──
T("query_file_tags", {
  title: "查询文件标签字典", description: "查租户文件标签字典（只读）。tagType：1常规 2BOM相关；tagPurpose：1文件标签 2交付物标签。",
  inputSchema: {
    tagType: z.number().int().describe("1常规 2BOM相关").optional(),
    tagPurpose: z.number().int().describe("1文件标签 2交付物标签").optional(),
  },
}, async (p) => {
  const r = await call("/open/api/saas/erp/file/listFileTag", { tagType: p.tagType, tagPurpose: p.tagPurpose });
  return { content: [{ type: "text", text: r.success !== false ? JSON.stringify(r.data, null, 1).slice(0, 3000) : "调用失败: " + JSON.stringify(r).slice(0, 300) }] };
});

await server.connect(new StdioServerTransport());
