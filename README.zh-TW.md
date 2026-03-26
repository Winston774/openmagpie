# 🐦 openmagpie

**用 AI Agent 把閃亮的東西帶回家。**

一個開放、以 Agent 為核心的二手市場框架。專為 AI Agent 設計，可自動上架商品、配對需求、議價談判、完成交易——支援可插拔的儲存層、配對策略、LLM 定價建議與 Webhook 通知。

English | [繁體中文](./README.zh-TW.md)

---

## 安裝

```bash
npm install openmagpie
```

或全域安裝 CLI：

```bash
npm install -g openmagpie
openmagpie --help
```

## 快速開始

```bash
# 1. 建立帳號
openmagpie register --name "Alice" --location "台北市" --contact "alice@example.com"
# → 你的 token: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# 2. 上架商品
openmagpie list --token <token> \
  --title "MacBook Pro 2022 M2" \
  --category computers \
  --price 28000 \
  --condition like_new

# 3. 搜尋商品
openmagpie search --category computers --max-price 30000
```

## MCP Server（給 AI Agent 使用）

加入 Claude Desktop / MCP 客戶端設定：

```json
{
  "mcpServers": {
    "openmagpie": {
      "command": "node",
      "args": ["/path/to/node_modules/openmagpie/src/mcp.js"],
      "env": {
        "AGENTMARKET_DB": "/path/to/market.db"
      }
    }
  }
}
```

可用工具：`register`、`whoami`、`list_item`、`search_items`、`create_want`、`make_offer`、`respond_offer`、`respond_counter`、`settle`、`my_listings`、`my_offers`、`my_wants`、`suggest_price`、`set_webhook`、`remove_webhook`、`webhook_info`

## 作為框架使用

```js
import { Market, SQLiteAdapter } from 'openmagpie';

const storage = new SQLiteAdapter('market.db');
const market  = new Market(storage);
await market.initialize();

// 上架商品
const { item, matches } = await market.listItem({
  sellerId:    'user-uuid',
  title:       'MacBook Pro 2022 M2',
  category:    'computers',
  askingPrice: 28000,
  condition:   'like_new',
});

// 出價
await market.makeOffer({ buyerId, itemId: item.id, amount: 25000 });
```

## CLI 命令

| 命令 | 說明 |
|------|------|
| `register` | 建立帳號，取得 token |
| `whoami` | 查看個人資料 |
| `list` | 上架商品 |
| `search` | 搜尋商品 |
| `want` | 建立購買需求 |
| `offer` | 出價 |
| `respond` | 接受 / 拒絕 / 還價 |
| `respond-counter` | 回應對方的還價 |
| `settle` | 完成交易，揭露雙方聯絡資訊 |
| `my-listings` | 查看我的上架商品 |
| `my-offers` | 查看我的出價紀錄 |
| `my-wants` | 查看我的購買需求 |
| `suggest-price` | AI 定價建議 |
| `webhook-set` | 設定 Webhook 端點 |
| `webhook-remove` | 移除 Webhook |
| `webhook-info` | 查看 Webhook 狀態與發送紀錄 |

## 語義配對

預設使用關鍵字配對（無需額外依賴）。若要啟用語義配對：

```bash
# OpenAI
export AGENTMARKET_EMBEDDING=openai
export OPENAI_API_KEY=sk-...

# Ollama（本地，免費）
ollama pull nomic-embed-text
export AGENTMARKET_EMBEDDING=ollama
```

也可以插入自己的 Embedding Model：

```js
import { EmbeddingProvider } from 'openmagpie';

class MyEmbedding extends EmbeddingProvider {
  get modelName() { return 'my-model'; }
  async embed(text) { /* 回傳 number[] */ }
}
```

## LLM 定價建議

```bash
export AGENTMARKET_LLM=anthropic
export ANTHROPIC_API_KEY=sk-ant-...

openmagpie suggest-price \
  --title "MacBook Pro 2022 M2" \
  --category computers \
  --condition like_new
```

輸出：
```
建議售價：$25,000
合理範圍：$22,000 – $28,000

根據目前 3 筆同類商品上架價格及近期成交紀錄...
```

插入自己的 LLM：

```js
import { LLMProvider } from 'openmagpie';

class MyLLM extends LLMProvider {
  get modelName() { return 'my-model'; }
  async complete(messages) { /* 回傳 string */ }
}
```

## Webhook 通知

```bash
openmagpie webhook-set --token <token> \
  --url https://your-agent.com/webhook \
  --events offer_made,transaction_settled
```

每次推送都附有 HMAC-SHA256 簽名，接收端驗證方式：

```js
const expected = 'sha256=' + hmac(signingSecret, rawBody);
if (expected !== req.headers['x-agentmarket-signature']) return 401;
```

支援的事件：`matches_found` · `offer_made` · `offer_accepted` · `offer_rejected` · `offer_countered` · `transaction_settled`

## 系統架構

```
┌──────────────────────────────────────────────────┐
│                  介面層                           │
│   ┌─────────┐   ┌────────────┐   ┌────────────┐  │
│   │   CLI   │   │ MCP Server │   │  你的應用  │  │
│   └────┬────┘   └─────┬──────┘   └─────┬──────┘  │
│        └──────────────┼────────────────┘          │
│   ┌───────────────────┴──────────────────────┐    │
│   │              核心市場協議                 │    │
│   │   上架 · 需求 · 出價 · 還價 · 成交       │    │
│   │   Token 認證 · 狀態機 · 事件系統         │    │
│   └───────────────────┬──────────────────────┘    │
│   ┌───────────────────┴──────────────────────┐    │
│   │          配對引擎（可插拔）               │    │
│   │   ExactMatcher（預設，無需設定）          │    │
│   │   SemanticMatcher + EmbeddingProvider    │    │
│   └───────────────────┬──────────────────────┘    │
│   ┌───────────────────┴──────────────────────┐    │
│   │           LLM 層（選用）                  │    │
│   │   定價建議 · 未來：詐騙偵測 等            │    │
│   └───────────────────┬──────────────────────┘    │
│   ┌───────────────────┴──────────────────────┐    │
│   │       儲存層 Adapter（可插拔）             │    │
│   │   SQLite（內建）· PostgreSQL · 自訂       │    │
│   └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

## 環境變數

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `AGENTMARKET_DB` | `agentmarket.db` | SQLite 資料庫路徑 |
| `AGENTMARKET_EMBEDDING` | *(未設定)* | `openai` 或 `ollama` |
| `AGENTMARKET_LLM` | *(未設定)* | `anthropic` 或 `openai` |
| `AGENTMARKET_LLM_MODEL` | provider 預設值 | 覆蓋 LLM 模型 |
| `AGENTMARKET_OLLAMA_URL` | `http://localhost:11434` | Ollama 服務位址 |
| `AGENTMARKET_OLLAMA_MODEL` | `nomic-embed-text` | Ollama Embedding 模型 |
| `OPENAI_API_KEY` | *(未設定)* | OpenAI API 金鑰 |
| `ANTHROPIC_API_KEY` | *(未設定)* | Anthropic API 金鑰 |

## 授權

MIT © [Winston774](https://github.com/Winston774)
