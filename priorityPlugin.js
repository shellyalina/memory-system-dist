/**
 * Memory Priority Plugin - 记忆优先级管理插件
 * 
 * 功能：
 * 1. 为记忆添加优先级标记（high/normal/low）
 * 2. 按优先级排序和过滤
 * 3. 重要事项置顶显示
 * 4. 自动提升长期未处理事项的优先级
 */

const fs = require('fs');
const path = require('path');

// ==================== 优先级配置 ====================

const PRIORITY_CONFIG = {
  levels: {
    high: { value: 3, label: '🔴 重要', daysToEscalate: 7 },
    normal: { value: 2, label: '🟡 一般', daysToEscalate: 30 },
    low: { value: 1, label: '🟢 低优先级', daysToEscalate: 90 }
  },
  
  // 自动升级规则
  autoEscalate: {
    enabled: true,
    checkInterval: 24 * 60 * 60 * 1000, // 每天检查一次
    rules: [
      { from: 'low', to: 'normal', afterDays: 30 },
      { from: 'normal', to: 'high', afterDays: 7 }
    ]
  }
};

// ==================== 时效管理辅助函数（复制自 memoryManager）====================

function memoryAgeDays(timestamp) {
  const now = Date.now();
  const age = Math.floor((now - timestamp) / (24 * 60 * 60 * 1000));
  return Math.max(0, age);
}

function getFreshnessLevel(timestamp) {
  const days = memoryAgeDays(timestamp);
  if (days <= 1) return 'fresh';
  if (days <= 7) return 'normal';
  if (days <= 30) return 'old';
  return 'stale';
}

class PriorityManager {
  constructor(memoryManager) {
    this.memoryManager = memoryManager;
    this.baseDir = memoryManager.baseDir;
    this.priorityFile = path.join(this.baseDir, 'priority-index.json');
    this.priorityMap = this.loadPriorityMap();
    
    // 启动自动升级检查
    if (PRIORITY_CONFIG.autoEscalate.enabled) {
      this.startAutoEscalation();
    }
  }
  
  /**
   * 加载优先级映射表
   */
  loadPriorityMap() {
    if (fs.existsSync(this.priorityFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.priorityFile, 'utf-8'));
      } catch (e) {
        console.error('[PriorityManager] 加载优先级索引失败:', e.message);
      }
    }
    return {};
  }
  
  /**
   * 保存优先级映射表
   */
  savePriorityMap() {
    fs.writeFileSync(this.priorityFile, JSON.stringify(this.priorityMap, null, 2), 'utf-8');
  }
  
  /**
   * 设置记忆优先级
   * @param {string} memoryId - 记忆ID
   * @param {'high'|'normal'|'low'} priority - 优先级
   * @param {string} [reason] - 设置原因
   */
  setPriority(memoryId, priority, reason = '') {
    if (!PRIORITY_CONFIG.levels[priority]) {
      throw new Error(`无效优先级: ${priority}，可选: high/normal/low`);
    }
    
    this.priorityMap[memoryId] = {
      level: priority,
      setAt: Date.now(),
      reason: reason,
      autoEscalated: false
    };
    
    this.savePriorityMap();
    
    // 同时更新记忆文件中的元数据
    this.updateMemoryPriorityInFile(memoryId, priority);
    
    return {
      memoryId,
      priority,
      label: PRIORITY_CONFIG.levels[priority].label,
      reason
    };
  }
  
  /**
   * 获取记忆优先级
   * @param {string} memoryId - 记忆ID
   * @returns {'high'|'normal'|'low'}
   */
  getPriority(memoryId) {
    // 优先从映射表获取
    if (this.priorityMap[memoryId]) {
      return this.priorityMap[memoryId].level;
    }
    
    // 尝试从记忆文件解析
    const memories = this.memoryManager.loadAll();
    const memory = memories.find(m => m.id === memoryId);
    if (memory && memory.priority) {
      return memory.priority;
    }
    
    // 默认根据类型推断
    if (memory) {
      // 用户显式创建的记忆默认高优先级
      if (memory.type === 'user') return 'high';
      // 任务类型默认普通优先级
      if (memory.type === 'task') return 'normal';
    }
    
    return 'low';
  }
  
  /**
   * 获取优先级信息（包含元数据）
   * @param {string} memoryId - 记忆ID
   * @returns {Object|null}
   */
  getPriorityInfo(memoryId) {
    const level = this.getPriority(memoryId);
    const config = PRIORITY_CONFIG.levels[level];
    const meta = this.priorityMap[memoryId] || {};
    
    return {
      level,
      label: config.label,
      value: config.value,
      setAt: meta.setAt || Date.now(),
      reason: meta.reason || '',
      autoEscalated: meta.autoEscalated || false
    };
  }
  
  /**
   * 更新记忆文件中的优先级元数据
   */
  updateMemoryPriorityInFile(memoryId, priority) {
    try {
      // 重新加载并保存记忆，确保优先级被写入
      const memories = this.memoryManager.loadAll();
      const memory = memories.find(m => m.id === memoryId);
      if (memory) {
        memory.priority = priority;
        memory.modified = Date.now();
        const filePath = this.memoryManager.getMemoryFilePath(memory);
        this.memoryManager.saveMemoryFile(filePath, memory);
      }
    } catch (e) {
      console.error('[PriorityManager] 更新文件优先级失败:', e.message);
    }
  }
  
  /**
   * 按优先级排序记忆
   * @param {Array} memories - 记忆数组
   * @param {Object} options - 选项
   * @param {boolean} [options.priorityFirst=true] - 是否优先按优先级排序
   * @param {boolean} [options.includeStale=false] - 是否包含陈旧记忆
   * @returns {Array}
   */
  sortByPriority(memories, options = {}) {
    const { priorityFirst = true, includeStale = false } = options;
    
    // 为每条记忆添加优先级信息
    const withPriority = memories.map(m => ({
      ...m,
      _priority: this.getPriorityInfo(m.id),
      _freshness: getFreshnessLevel(m.created)
    }));
    
    // 过滤掉陈旧记忆（可选）
    const filtered = includeStale 
      ? withPriority 
      : withPriority.filter(m => m._freshness !== 'stale');
    
    return filtered.sort((a, b) => {
      if (priorityFirst) {
        // 优先级高的在前
        const priorityDiff = b._priority.value - a._priority.value;
        if (priorityDiff !== 0) return priorityDiff;
      }
      
      // 同优先级：新的在前
      return b.created - a.created;
    });
  }
  
  /**
   * 获取高优先级记忆
   * @param {number} [limit=10] - 数量限制
   * @returns {Array}
   */
  getHighPriority(limit = 10) {
    const memories = this.memoryManager.loadAll();
    const highPriority = memories.filter(m => this.getPriority(m.id) === 'high');
    return this.sortByPriority(highPriority, { priorityFirst: false }).slice(0, limit);
  }
  
  /**
   * 获取待处理的重要事项
   * 结合优先级和时效，找出需要关注的事项
   * @param {number} [limit=5] - 数量限制
   * @returns {Array}
   */
  getPendingImportant(limit = 5) {
    const memories = this.memoryManager.loadAll();
    const now = Date.now();
    
    // 计算每条记忆的"紧急度分数"
    const scored = memories.map(m => {
      const priority = this.getPriorityInfo(m.id);
      const age = (now - m.created) / (24 * 60 * 60 * 1000); // 天数
      
      // 紧急度 = 优先级 * 10 + 年龄权重
      const urgencyScore = priority.value * 10 + Math.min(age, 30);
      
      return {
        ...m,
        _priority: priority,
        _age: age,
        _urgencyScore: urgencyScore
      };
    });
    
    // 按紧急度排序
    scored.sort((a, b) => b._urgencyScore - a._urgencyScore);
    
    return scored.slice(0, limit);
  }
  
  /**
   * 自动升级检查
   * 根据规则自动提升长期未处理事项的优先级
   */
  checkAutoEscalation() {
    const now = Date.now();
    let escalatedCount = 0;
    
    Object.entries(this.priorityMap).forEach(([memoryId, meta]) => {
      const daysSinceSet = (now - meta.setAt) / (24 * 60 * 60 * 1000);
      
      // 检查是否需要升级
      for (const rule of PRIORITY_CONFIG.autoEscalate.rules) {
        if (meta.level === rule.from && daysSinceSet >= rule.afterDays) {
          this.priorityMap[memoryId] = {
            ...meta,
            level: rule.to,
            autoEscalated: true,
            escalatedAt: now
          };
          escalatedCount++;
          console.log(`[PriorityManager] 自动升级: ${memoryId} ${rule.from} -> ${rule.to}`);
          break;
        }
      }
    });
    
    if (escalatedCount > 0) {
      this.savePriorityMap();
    }
    
    return escalatedCount;
  }
  
  /**
   * 启动自动升级检查定时器
   */
  startAutoEscalation() {
    setInterval(() => {
      this.checkAutoEscalation();
    }, PRIORITY_CONFIG.autoEscalate.checkInterval);
    
    console.log('[PriorityManager] 自动升级检查已启动');
  }
  
  /**
   * 格式化优先级显示
   * @param {string} memoryId - 记忆ID
   * @returns {string}
   */
  formatPriority(memoryId) {
    const info = this.getPriorityInfo(memoryId);
    return info.label;
  }
  
  /**
   * 获取优先级统计
   * @returns {Object}
   */
  getStats() {
    const memories = this.memoryManager.loadAll();
    const stats = { high: 0, normal: 0, low: 0, total: memories.length };
    
    memories.forEach(m => {
      const level = this.getPriority(m.id);
      stats[level]++;
    });
    
    return stats;
  }
  
  /**
   * 批量设置优先级
   * @param {Array<{id: string, priority: string, reason?: string}>} items
   * @returns {Array}
   */
  batchSetPriority(items) {
    return items.map(item => {
      try {
        return this.setPriority(item.id, item.priority, item.reason);
      } catch (e) {
        return { id: item.id, error: e.message };
      }
    });
  }
  
  /**
   * 清理已删除记忆的优先级记录
   */
  cleanup() {
    const memories = this.memoryManager.loadAll();
    const validIds = new Set(memories.map(m => m.id));
    let cleaned = 0;
    
    Object.keys(this.priorityMap).forEach(id => {
      if (!validIds.has(id)) {
        delete this.priorityMap[id];
        cleaned++;
      }
    });
    
    if (cleaned > 0) {
      this.savePriorityMap();
      console.log(`[PriorityManager] 清理了 ${cleaned} 条无效优先级记录`);
    }
    
    return cleaned;
  }
}

// ==================== 导出 ====================

module.exports = {
  PriorityManager,
  PRIORITY_CONFIG
};

// 测试代码
if (require.main === module) {
  const { MemoryManager } = require('./memoryManager');
  
  console.log('Priority Plugin - Test Mode\n');
  
  const memoryManager = new MemoryManager();
  const priorityManager = new PriorityManager(memoryManager);
  
  // 创建测试记忆
  console.log('=== 创建测试记忆 ===');
  
  const mem1 = memoryManager.create({
    type: 'user',
    content: '这是一个重要的用户偏好设置',
    title: '重要偏好',
    tags: ['偏好', '重要']
  });
  priorityManager.setPriority(mem1.id, 'high', '用户显式设置，需优先处理');
  console.log(`创建: ${mem1.id} - ${priorityManager.formatPriority(mem1.id)}`);
  
  const mem2 = memoryManager.create({
    type: 'task',
    content: '这是一个普通的待办任务',
    title: '普通任务',
    tags: ['任务']
  });
  priorityManager.setPriority(mem2.id, 'normal');
  console.log(`创建: ${mem2.id} - ${priorityManager.formatPriority(mem2.id)}`);
  
  const mem3 = memoryManager.create({
    type: 'auto',
    content: '这是一个自动提取的低优先级记忆',
    title: '自动记忆',
    tags: ['自动']
  });
  // 不设置优先级，使用默认
  console.log(`创建: ${mem3.id} - ${priorityManager.formatPriority(mem3.id)}`);
  
  // 测试排序
  console.log('\n=== 按优先级排序 ===');
  const allMemories = memoryManager.loadAll();
  const sorted = priorityManager.sortByPriority(allMemories);
  sorted.forEach((m, i) => {
    console.log(`${i + 1}. ${priorityManager.formatPriority(m.id)} ${m.title}`);
  });
  
  // 测试获取高优先级
  console.log('\n=== 高优先级记忆 ===');
  const highPriority = priorityManager.getHighPriority();
  highPriority.forEach((m, i) => {
    console.log(`${i + 1}. ${m.title}`);
  });
  
  // 测试获取待处理事项
  console.log('\n=== 待处理重要事项 ===');
  const pending = priorityManager.getPendingImportant();
  pending.forEach((m, i) => {
    console.log(`${i + 1}. [紧急度:${m._urgencyScore.toFixed(1)}] ${m.title}`);
  });
  
  // 统计
  console.log('\n=== 优先级统计 ===');
  console.log(priorityManager.getStats());
  
  console.log('\nDone!');
}
