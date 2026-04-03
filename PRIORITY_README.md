# 🎯 记忆优先级插件 - 使用指南

## 功能概述

为记忆系统添加**优先级管理**功能，支持区分重要和非重要事项，实现智能排序和提醒。

## 优先级等级

| 等级 | 标识 | 说明 | 自动升级时间 |
|------|------|------|-------------|
| 🔴 **High** | 重要 | 关键信息、用户显式设置 | 7天未处理自动升级 |
| 🟡 **Normal** | 一般 | 普通任务、一般信息 | 30天未处理升级为High |
| 🟢 **Low** | 低优先级 | 自动提取、辅助信息 | 90天未处理升级为Normal |

## 快速使用

```javascript
const { createMemoryManager } = require('./memory-system/integration');

// 创建带优先级功能的记忆管理器
const memory = createMemoryManager();

// 1. 创建记忆并设置优先级
const mem = memory.create({
  type: 'user',
  content: '这是一个重要的用户偏好设置',
  title: '重要偏好',
  tags: ['偏好']
});

// 设置高优先级
memory.setPriority(mem.id, 'high', '用户显式设置，需优先处理');

// 2. 获取高优先级记忆
const important = memory.getHighPriority(10);
console.log('重要事项:', important.map(m => m.title));

// 3. 获取待处理的重要事项（结合优先级和时效）
const pending = memory.getPendingImportant(5);
console.log('待处理:', pending.map(m => m.title));

// 4. 查看优先级统计
const stats = memory.getPriorityStats();
console.log(`High: ${stats.high}, Normal: ${stats.normal}, Low: ${stats.low}`);

// 5. 按优先级排序记忆
const allMemories = memory.loadAll();
const sorted = memory.sortByPriority(allMemories);
```

## API 说明

### setPriority(memoryId, priority, reason)
设置记忆优先级
- `memoryId`: 记忆ID
- `priority`: 'high' | 'normal' | 'low'
- `reason`: 设置原因（可选）

### getPriority(memoryId)
获取记忆优先级，返回 'high' | 'normal' | 'low'

### getHighPriority(limit)
获取高优先级记忆列表
- `limit`: 返回数量限制（默认10）

### getPendingImportant(limit)
获取待处理的重要事项（按紧急度排序）
- `limit`: 返回数量限制（默认5）

### getPriorityStats()
获取优先级统计信息

### sortByPriority(memories, options)
按优先级排序记忆
- `options.priorityFirst`: 是否优先按优先级排序（默认true）
- `options.includeStale`: 是否包含陈旧记忆（默认false）

## 自动升级机制

系统会自动检查并升级长期未处理的事项：

- **Low → Normal**: 30天未处理
- **Normal → High**: 7天未处理

升级规则可配置：
```javascript
const { PRIORITY_CONFIG } = require('./memory-system/priorityPlugin');

// 自定义升级规则
PRIORITY_CONFIG.autoEscalate.rules = [
  { from: 'low', to: 'normal', afterDays: 14 },    // 14天升级
  { from: 'normal', to: 'high', afterDays: 3 }     // 3天升级
];
```

## 默认优先级规则

未显式设置优先级的记忆，系统根据类型自动推断：

| 记忆类型 | 默认优先级 | 说明 |
|---------|-----------|------|
| `user` | **high** | 用户显式创建，通常重要 |
| `task` | **normal** | 任务类型，普通优先级 |
| `auto` | **low** | 自动提取，低优先级 |

## 与检索功能结合

优先级功能可与语义搜索、混合搜索结合使用：

```javascript
// 先搜索相关记忆
const results = memory.hybridSearch('简报');

// 再按优先级排序
const prioritized = memory.sortByPriority(results);

// 优先显示重要事项
prioritized.forEach(m => {
  const p = memory.getPriority(m.id);
  console.log(`${p === 'high' ? '🔴' : p === 'normal' ? '🟡' : '🟢'} ${m.title}`);
});
```

## 文件结构

```
memory-system/
├── priorityPlugin.js      # 优先级插件主文件
├── priority-index.json    # 优先级索引（自动生成）
└── ...
```

## 注意事项

1. 优先级信息存储在 `priority-index.json` 中，与记忆文件分离
2. 设置优先级时会同时更新记忆文件的元数据
3. 删除记忆后，优先级记录会自动清理（可手动调用 `cleanup()`）
4. 自动升级检查每天运行一次

## 示例：每日重要事项检查

```javascript
// 每天早上检查重要事项
function checkImportantItems() {
  const memory = createMemoryManager();
  
  // 获取高优先级记忆
  const highPriority = memory.getHighPriority();
  
  // 获取待处理事项
  const pending = memory.getPendingImportant(10);
  
  if (highPriority.length > 0) {
    console.log(`🔔 你有 ${highPriority.length} 条重要记忆需要关注：`);
    highPriority.forEach(m => console.log(`  - ${m.title}`));
  }
  
  if (pending.length > 0) {
    console.log(`\n⏰ 待处理事项（按紧急度排序）：`);
    pending.forEach((m, i) => {
      console.log(`  ${i+1}. ${m.title}`);
    });
  }
}

checkImportantItems();
```
