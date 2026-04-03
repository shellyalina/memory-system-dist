# 🧠 Memory System

> 基于 Claude Code 记忆系统设计的 Node.js 实现

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

一个功能完整的记忆管理系统，支持时效管理、语义检索、自动压缩和优先级管理。

## ✨ 特性

- **🕐 时效管理** - 自动标记记忆新鲜度，超过1天的记忆附加时效警告
- **🔍 语义搜索** - 基于 TF-IDF 的向量检索，支持同义词匹配
- **📊 混合搜索** - 结合关键词搜索和语义搜索，提升检索准确性
- **🗜️ 自动压缩** - 相似记忆自动合并，智能摘要减少冗余
- **🎯 优先级管理** - 支持高/中/低三级优先级，自动升级长期未处理事项
- **📁 分类存储** - auto/user/task/daily 四种记忆类型

## 📦 安装

```bash
npm install memory-system
```

## 🚀 快速开始

```javascript
const { createMemoryManager } = require('memory-system');

// 创建记忆管理器
const memory = createMemoryManager();

// 创建记忆
const mem = memory.create({
  type: 'user',
  content: '用户偏好技术流风格的简报',
  title: '用户偏好',
  tags: ['偏好', '简报']
});

// 设置优先级
memory.setPriority(mem.id, 'high', '重要用户偏好');

// 语义搜索
const results = memory.semanticSearch('简报风格');

// 获取高优先级记忆
const important = memory.getHighPriority(10);
```

## 📖 API 文档

### 创建记忆

```javascript
memory.create({
  type: 'user',           // 类型: 'auto' | 'user' | 'task'
  content: '记忆内容',     // 必填
  title: '标题',          // 可选
  tags: ['标签1', '标签2'], // 可选
  source: '来源'          // 可选
});
```

### 搜索记忆

```javascript
// 关键词搜索
memory.findRelevant({ query: '简报', limit: 10 });

// 语义搜索
memory.semanticSearch('简报风格', { limit: 10 });

// 混合搜索
memory.hybridSearch('简报', { limit: 10 });
```

### 优先级管理

```javascript
// 设置优先级
memory.setPriority(memoryId, 'high', '原因说明');

// 获取高优先级记忆
memory.getHighPriority(10);

// 获取待处理事项
memory.getPendingImportant(5);
```

## 📁 文件结构

```
memory-system/
├── memoryManager.js       # 核心记忆管理器
├── priorityPlugin.js      # 优先级管理插件
├── vectorStore.js         # 向量存储与语义检索
├── extractor.js           # 记忆提取器
├── compressor.js          # 记忆压缩器
├── integration.js         # 集成入口
├── LICENSE                # MIT 许可证
└── README.md              # 项目文档
```

## 🔧 高级配置

```javascript
const memory = createMemoryManager({
  baseDir: './custom-memory',           // 自定义存储路径
  enableBackgroundExtraction: true,     // 启用后台提取
  enableAutoCompress: true,             // 启用自动压缩
  extractionSensitivity: 'high',        // 提取敏感度
  compressThreshold: 100                // 压缩阈值
});
```

## 🧪 测试

```bash
npm test
```

## 📄 许可证

[MIT](LICENSE) © Memory System Contributors

## 🙏 致谢

设计灵感来自 [Claude Code](https://github.com/anthropics/claude-code) 的记忆系统。
