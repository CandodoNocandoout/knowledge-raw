# A 股智能投研系统 V2 设计规范

**版本：V2.0**\
**状态：设计冻结，进入实现阶段**\
**适用范围：A 股数据服务 + Dify 投研 Workflow**\
**V3 规划：接入"孙子知识库"及其他外部知识库，暂不实现**

------------------------------------------------------------------------

## 1. 文档目的

本文档用于冻结当前 A 股智能投研系统 V2 的整体架构，作为后续 Python /
FastAPI 数据服务、PostgreSQL 数据模型、Dify
Workflow、数据接口和知识检索设计的统一规范。

核心链路：

> **自然语言问题 → 需求理解 → 数据需求规划 → 标准数据 API → 知识检索 →
> 上下文构建 → LLM 分析**

------------------------------------------------------------------------

## 2. 总体架构

``` text
用户问题
   │
   ▼
┌──────────────────────┐
│ 1. Query Classifier  │
│    问题分类           │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 2. Security Resolver │
│    证券实体解析       │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────┐
│ 3. Data Requirement      │
│    Planner               │
│    数据需求规划           │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│ 4. Data API Layer        │
│    标准数据服务           │
└──────────┬───────────────┘
           │
           ├──────────────┐
           │              │
           ▼              ▼
      市场/证券数据     行业/指数数据
           │              │
           └──────┬───────┘
                  ▼
┌──────────────────────────┐
│ 5. Knowledge Retrieval   │
│    知识检索               │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│ 6. Context Builder       │
│    上下文构建             │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│ 7. Final LLM             │
│    最终分析               │
└──────────┬───────────────┘
           │
           ▼
          End
```

------------------------------------------------------------------------

## 3. V2 核心设计原则

### 3.1 Workflow 不直接依赖数据库结构

Dify 不应该知道 PostgreSQL 有哪些表、字段叫什么、字段如何计算或 AKShare
使用哪个数据源。

例如：

``` text
PostgreSQL
stock_daily
stock_basic
stock_realtime_quote
```

不应该直接暴露给 Dify。

Dify 只看到：

``` text
/api/v1/stock/overview
/api/v1/stock/history
```

这样数据库结构可以变化，而 Workflow 不需要跟着变化。

### 3.2 数据 API 面向业务能力，而不是数据库表

错误：

``` text
GET /api/table/stock_daily
GET /api/table/stock_basic
```

正确：

``` text
GET /api/v1/stock/overview
GET /api/v1/stock/history
GET /api/v1/market/overview
```

API 回答的是"投研系统需要什么信息"，而不是"数据库里面有什么表"。

### 3.3 Security Resolver 不是所有问题的入口

Security Resolver 只负责证券实体解析。

例如：

``` text
生益科技现在还能不能买？
→ 600183
```

但：

``` text
现在适合持币还是持股？
```

不需要股票解析。

``` text
PCB 目前处于什么阶段？
```

需要 Sector 实体，而不一定需要某只股票。

因此：

> **Security Resolver 是实体解析模块，而不是股票查询模块。**

------------------------------------------------------------------------

## 4. Data Model Layer

V2 第一阶段定义四类标准实体：

``` text
Market
Stock
Sector
Index
```

Data Model Layer 的作用是把底层数据库、AKShare
数据源等实现细节抽象成稳定的业务实体。

------------------------------------------------------------------------

## 5. Market 模型

Market 表示整个 A 股市场及其市场状态，不是一只证券，也不是一个指数。

可包含：

-   上涨家数
-   下跌家数
-   涨停家数
-   跌停家数
-   总成交额
-   成交额变化
-   市场平均涨跌
-   市场强弱
-   市场情绪

接口：

``` http
GET /api/v1/market/overview
```

第一阶段不急于建立 `market`
主表。市场概览可以通过现有实时行情、指数等数据实时聚合得到。

------------------------------------------------------------------------

## 6. Stock 模型

Stock 表示单只 A 股证券，唯一标识为：

``` text
code
```

例如：

``` text
600183
```

基础属性：

``` text
code
name
exchange
market
```

现有数据库：

``` text
stock_basic
```

继续作为 Stock 基础数据存储。

### Stock 与行情数据

``` text
Stock
 ├── Realtime Quote
 └── Daily History
```

对应：

``` text
stock_basic
stock_realtime_quote
stock_daily
```

因此现阶段不为了 API 再建立新的 Stock 主表。

### Stock Overview

``` http
GET /api/v1/stock/overview?codes=600183,300570,300666
```

用于给 LLM 提供当前状态摘要，建议包含：

``` text
latest
performance
trend
volume
```

例如：

``` json
{
  "data": [
    {
      "code": "600183",
      "name": "生益科技",
      "latest": {
        "price": 145.20,
        "change_percent": 1.82,
        "volume": 52310000,
        "amount": 758000000
      },
      "performance": {
        "return_5d": 3.2,
        "return_20d": 8.7,
        "return_60d": 21.4
      },
      "trend": {
        "ma5": 143.2,
        "ma10": 141.8,
        "ma20": 138.5,
        "ma60": 129.7,
        "above_ma20": true,
        "above_ma60": true
      }
    }
  ]
}
```

------------------------------------------------------------------------

## 7. Sector 模型

### 7.1 为什么 Sector 最复杂

Stock 有明确代码，Index 有明确代码，但：

``` text
PCB
通信设备
AI硬件
算力
半导体
```

这些概念不是天然唯一的证券实体。

因此 Sector 必须建立自己的标准化模型。

### 7.2 Sector 第一阶段原则

V2 第一阶段不追求覆盖所有市场概念，只建立：

> **稳定、可解释、可维护的行业/主题板块体系。**

至少包含：

``` text
sector_id
name
type
source
```

其中：

``` text
type:
industry
theme
```

例如：

``` text
PCB        industry/theme
通信设备    industry
半导体      industry
AI硬件      theme
```

### 7.3 Sector Constituents

Sector 与 Stock 是多对多关系：

``` text
Sector
   │
   ├── Stock A
   ├── Stock B
   ├── Stock C
   └── ...
```

同一只股票可以属于多个 Sector，因此不能简单在 `stock_basic` 增加一个
`sector` 字段。

建立独立关系表：

``` text
sector_stock
```

建议字段：

``` text
sector_id
stock_code
weight
source
effective_date
```

第一阶段如果没有可靠权重：

``` text
weight = NULL
```

不要伪造权重。

------------------------------------------------------------------------

## 8. Index 模型

Index 表示指数，例如：

``` text
000001 上证指数
000688 科创50
399006 创业板指
```

建议建立：

``` text
index_basic
index_daily
```

逻辑：

``` text
Index
 └── Index Daily
```

------------------------------------------------------------------------

## 9. 四类实体关系

``` text
                    ┌─────────────┐
                    │   Market    │
                    └──────┬──────┘
                           │
                     包含/统计
                           │
                           ▼
                    ┌─────────────┐
                    │    Stock    │
                    └──────┬──────┘
                           │
                    多对多 / 归属
                           │
                           ▼
                    ┌─────────────┐
                    │   Sector    │
                    └─────────────┘


                    ┌─────────────┐
                    │    Index    │
                    └──────┬──────┘
                           │
                       成分股
                           │
                           ▼
                    ┌─────────────┐
                    │    Stock    │
                    └─────────────┘
```

四类实体职责：

-   Market：市场状态聚合实体
-   Stock：基础证券实体
-   Sector：行业/主题聚合实体
-   Index：指数实体

------------------------------------------------------------------------

## 10. Data API Layer

V2 第一阶段：

``` text
/api/v1
│
├── /market
│   └── /overview
│
├── /stock
│   ├── /overview
│   └── /history
│
├── /sector
│   ├── /overview
│   ├── /ranking
│   └── /history
│
└── /index
    ├── /overview
    └── /history
```

未来扩展：

``` text
/api/v1/financial
/api/v1/technical
/api/v1/capital-flow
/api/v1/macro
/api/v1/news
```

这些不属于 V2 第一阶段必须完成的接口。

------------------------------------------------------------------------

## 11. Overview 与 History 的职责

### Overview

用于：

> LLM 快速理解当前状态。

特点：

-   数据少
-   已计算
-   语义明确
-   不需要 LLM 自己计算大量指标

例如：

``` text
5日涨跌幅
20日涨跌幅
MA5
MA20
MA60
是否站上均线
量能变化
```

### History

用于精确历史分析、趋势分析和进一步计算。

例如：

``` http
GET /api/v1/stock/history
```

返回：

``` text
date
open
high
low
close
volume
amount
```

原则：

> 默认不把完整历史 K 线直接塞给 Final LLM。

只有 Data Requirement Planner 判断需要历史数据时才调用。

------------------------------------------------------------------------

## 12. 统一 API Response

所有 API 使用：

``` json
{
  "status": "ok",
  "request_id": "xxx",
  "data": {},
  "meta": {
    "data_time": "2026-10-06 09:35:00",
    "source": "stock-api",
    "is_realtime": true
  }
}
```

金融数据必须携带：

``` text
data_time
source
is_realtime
```

因为实时行情、5 分钟前行情、昨日收盘、历史数据的时效性完全不同。

------------------------------------------------------------------------

## 13. Data Requirement Planner

这是 V2 Workflow 最核心的节点之一。

它不负责获取数据，只回答：

> **为了回答用户这个问题，需要哪些数据？**

输出标准化 Requirement：

``` json
{
  "requirements": [
    {
      "type": "market"
    },
    {
      "type": "sector",
      "entities": ["PCB", "通信"]
    },
    {
      "type": "security",
      "entities": ["600183", "300570"]
    }
  ]
}
```

------------------------------------------------------------------------

## 14. Question Type

V2 支持：

``` text
market
stock
sector
multi_stock
portfolio
macro
industry
trading
comparison
mixed
general
```

示例：

  问题                            类型
  ------------------------------- --------------------------
  现在适合持币还是持股            market
  生益科技现在还能不能买          stock
  PCB 目前处于什么阶段            sector
  生益科技、太辰光谁更值得配置    multi_stock / comparison
  我现在70%仓位是否应该降仓       portfolio
  美联储降息对科技股有什么影响    macro
  AI 硬件产业链现在处于什么阶段   industry
  明天应该怎么操作                trading
  这个股票和那个股票谁更强        comparison
  多维度混合问题                  mixed
  非投研知识问题                  general

------------------------------------------------------------------------

## 15. Security Resolver

职责：

``` text
自然语言证券名称
        ↓
标准证券实体
```

例如：

``` text
生益科技
↓
600183
```

多股票：

``` text
生益科技、太辰光、江丰电子
↓
600183
300570
300666
```

输出：

``` json
{
  "resolved": true,
  "securities": [
    {
      "code": "600183",
      "name": "生益科技"
    }
  ]
}
```

无法确认时：

``` json
{
  "resolved": false,
  "candidates": []
}
```

原则：

> **不允许猜测证券代码。**

------------------------------------------------------------------------

## 16. Planner 与 Resolver 的关系

两者职责必须分离：

``` text
Security Resolver
    ↓
“用户说的是谁？”

Data Requirement Planner
    ↓
“回答这个问题需要什么数据？”
```

例如：

``` text
生益科技现在还能不能买？
```

Resolver：

``` text
600183
```

Planner：

``` text
market
stock
sector
technical
knowledge
```

------------------------------------------------------------------------

## 17. 数据调用策略

独立数据源优先并行调用：

``` text
               ┌── Market API
               │
Planner ────────┼── Stock API
               │
               ├── Sector API
               │
               └── Knowledge Retrieval
```

最后统一进入：

``` text
Context Builder
```

这样可以降低 Workflow 延迟。

------------------------------------------------------------------------

## 18. Knowledge Retrieval

V2 当前只使用现有本地知识库体系。

知识库主要负责：

-   投资框架
-   行业知识
-   公司知识
-   宏观知识
-   用户自己的交易方法
-   AI 产业链知识
-   历史研究资料

知识库不替代实时行情 API。

例如：

``` text
“生益科技今天涨了多少？”
```

应该使用：

``` text
Data API
```

而不是：

``` text
Knowledge Retrieval
```

而：

``` text
PCB 产业链为什么受益于 AI 服务器升级
```

属于知识检索问题。

------------------------------------------------------------------------

## 19. Context Builder

Context Builder 是数据与知识之间的最后一道整理层。

输入：

``` text
Market Data
Stock Data
Sector Data
Index Data
Knowledge
User Question
```

输出：

``` text
Final LLM Context
```

建议组织为：

``` text
# 用户问题

# 当前市场数据

# 证券数据

# 板块数据

# 指数数据

# 知识库信息

# 数据时间与来源

# 分析要求
```

------------------------------------------------------------------------

## 20. Final LLM

Final LLM 负责：

-   综合事实
-   判断市场环境
-   结合知识库
-   进行概率分析
-   给出交易逻辑
-   指出风险
-   对用户已有观点进行反证

Final LLM 不负责：

-   自己查询数据库
-   自己猜证券代码
-   自己计算大量历史指标
-   假设数据是实时的
-   编造不存在的数据

------------------------------------------------------------------------

## 21. 完整执行示例：股票问题

用户：

``` text
生益科技现在还能不能买？
```

执行：

``` text
Query Classifier
↓
stock
↓
Security Resolver
↓
600183 / 生益科技
↓
Data Requirement Planner
↓
需要：
  Market
  Stock
  Sector
  Technical
  Knowledge
↓
Data API Layer
↓
并行获取
↓
Knowledge Retrieval
↓
Context Builder
↓
Final LLM
↓
输出分析
```

------------------------------------------------------------------------

## 22. 完整执行示例：市场问题

用户：

``` text
现在适合持币还是持股？
```

执行：

``` text
Query Classifier
↓
market
↓
无需 Security Resolver
↓
Data Requirement Planner
↓
Market
Index
Capital Flow（未来）
Macro（未来）
Knowledge
↓
Context Builder
↓
Final LLM
```

核心原则：

> 不再把所有问题强制转换成"股票查询"。

------------------------------------------------------------------------

## 23. 完整执行示例：板块问题

用户：

``` text
PCB 现在处于什么阶段？
```

执行：

``` text
Query Classifier
↓
sector
↓
Sector Entity
↓
PCB
↓
Data Requirement Planner
↓
Sector
Market
Index
Constituents
Technical
Knowledge
↓
Context Builder
↓
Final LLM
```

------------------------------------------------------------------------

## 24. 完整执行示例：多股票比较

用户：

``` text
生益科技、太辰光、江丰电子谁更值得配置？
```

执行：

``` text
Query Classifier
↓
multi_stock / comparison
↓
Security Resolver
↓
600183
300570
300666
↓
Data Requirement Planner
↓
批量 Stock
批量 Sector
Market
Technical
Knowledge
↓
Context Builder
↓
Final LLM
```

必须支持批量 API：

``` http
/api/v1/stock/overview?codes=600183,300570,300666
```

而不是分别调用三次。

------------------------------------------------------------------------

## 25. Portfolio 问题

用户：

``` text
我现在70%仓位，结合市场环境要不要降仓？
```

Planner 应识别：

``` text
Market
Portfolio
Stock
Sector
Technical
Knowledge
```

Portfolio 当前可以先作为 Workflow 上下文，不要求 V2
第一阶段建立独立数据库。

------------------------------------------------------------------------

## 26. 数据层与知识层边界

严格区分：

``` text
事实数据
    ↓
Data API

解释性知识
    ↓
Knowledge Retrieval
```

例如：

``` text
生益科技今天涨 2%
```

属于事实数据。

``` text
PCB 产业链为什么受益于 AI 服务器升级
```

属于知识。

``` text
生益科技当前是否值得买
```

属于：

``` text
数据 + 知识 + 推理
```

------------------------------------------------------------------------

## 27. V3 演进

V2 不实现外部知识库融合。

V3 才增加：

``` text
                    Knowledge Retrieval
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
        本地知识库      孙子知识库      其他知识库
             │              │              │
             └──────────────┼──────────────┘
                            ▼
                    Knowledge Fusion
                            │
                            ▼
                     Context Builder
```

V3 进一步解决：

``` text
source authority
recency
relevance
conflict resolution
```

尤其需要处理：

> 用户自己的投资框架与外部知识发生冲突时，不能简单拼接文本，而应保留来源并让
> Final LLM 进行证据权衡。

V3 暂不进入 V2 实现。

------------------------------------------------------------------------

## 28. 当前数据库与 V2 模型对应关系

已有：

``` text
stock_basic
    ↓
Stock

stock_realtime_quote
    ↓
Stock Realtime

stock_daily
    ↓
Stock History
```

后续新增：

``` text
index_basic
index_daily

sector_basic
sector_stock
```

市场概览第一阶段通过现有行情和指数数据聚合，不急于建立 `market` 主表。

------------------------------------------------------------------------

## 29. 推荐落地顺序

### 第一阶段：数据模型

复用：

``` text
stock_basic
stock_realtime_quote
stock_daily
```

新增：

``` text
index_basic
index_daily
sector_basic
sector_stock
```

### 第二阶段：基础 API

实现：

``` text
/api/v1/market/overview
/api/v1/stock/overview
/api/v1/stock/history
/api/v1/index/overview
/api/v1/index/history
```

### 第三阶段：Sector API

实现：

``` text
/api/v1/sector/overview
/api/v1/sector/ranking
/api/v1/sector/history
```

Sector 因数据源和成分维护复杂度最高，最后实现。

------------------------------------------------------------------------

## 30. V2 冻结项

### Workflow

``` text
Query Classifier
→ Security Resolver
→ Data Requirement Planner
→ Data API Layer
→ Knowledge Retrieval
→ Context Builder
→ Final LLM
```

### 标准实体

``` text
Market
Stock
Sector
Index
```

### API 分层

``` text
/api/v1/market
/api/v1/stock
/api/v1/sector
/api/v1/index
```

### 数据与知识职责

``` text
事实数据 → Data API
知识 → Knowledge Retrieval
推理 → Final LLM
```

### V3

``` text
外部知识库 / 孙子知识库
```

暂不实现。

------------------------------------------------------------------------

## 31. 后续开发原则

1.  **先模型，再 API，再 Workflow。**
2.  **不为了迎合 Workflow 修改数据库语义。**
3.  **API 面向业务能力，而不是数据库表。**
4.  **能批量获取的数据必须支持批量接口。**
5.  **独立数据源优先并行调用。**
6.  **所有金融数据必须携带数据时间与来源。**
7.  **Overview 面向 LLM，History 面向精确分析。**
8.  **技术指标由 stock-api 计算，不交给 Dify LLM 计算。**
9.  **Security Resolver 不得猜测证券代码。**
10. **V2 不提前引入 V3 的外部知识库融合逻辑。**
11. **接口尽量保持向后兼容，避免 Workflow 与数据服务强耦合。**
12. **最终判断必须区分事实、知识与推理。**

------------------------------------------------------------------------

## 32. 当前实施状态

已完成：

``` text
[x] PostgreSQL 独立 stock 数据库
[x] stock_basic
[x] stock_realtime_quote
[x] stock_daily
[x] AKShare 实时行情接入
[x] 腾讯历史行情接入
[x] FastAPI 基础服务
[x] Dify → stock-api 网络打通
[x] 历史数据自动同步
[x] 基础行情 API
```

V2 下一步：

``` text
[ ] Data Model Layer 落地
[ ] index_basic
[ ] index_daily
[ ] sector_basic
[ ] sector_stock
[ ] /api/v1/market
[ ] /api/v1/stock
[ ] /api/v1/index
[ ] /api/v1/sector
[ ] Data Requirement Planner
[ ] Context Builder
[ ] Dify V2 Workflow 接入新 API
```

V3：

``` text
[ ] 孙子知识库
[ ] 其他知识库
[ ] Knowledge Fusion
[ ] 来源权威性
[ ] 知识冲突处理
```

------------------------------------------------------------------------

## 33. 一句话架构定义

> **V2 是一个以标准金融实体为核心、以业务数据 API 为数据边界、以 Dify
> 为推理编排层、以知识库为解释性知识来源、最终由 LLM 完成综合判断的 A
> 股智能投研系统。**
