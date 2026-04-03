/**
 * Memory System - Core Implementation
 * 
 * 基于 Claude Code 记忆系统设计
 * 提供记忆时效管理、类型分类、检索排序等功能
 */

const fs = require('fs');
const path = require('path');
const { VectorStore } = require('./vectorStore');

// ==================== 配置 ====================

const CONFIG = {
  // 记忆系统根目录
  baseDir: '/root/.openclaw/workspace/memory-system',
  
  // 记忆类型及其存储路径
  types: {
    auto: 'auto',
    user: 'user',
    task: 'task',
    daily: 'logs'
  },
  
  // 时效阈值（天数）
  freshness: {
    fresh: 1,      // 0-1天：新鲜
    normal: 7,     // 2-7天：一般
    old: 30        // 8-30天：较旧
  }
};

// ==================== 记忆类型定义 ====================

/**
 * @typedef {Object} Memory
 * @property {string} id - 记忆唯一标识
 * @property {'auto'|'user'|'task'|'daily'} type - 记忆类型
 * @property {string} content - 记忆内容
 * @property {number} created - 创建时间戳
 * @property {number} modified - 修改时间戳
 * @property {string[]} tags - 标签列表
 * @property {string} [source] - 来源
 * @property {string} [title] - 标题
 */

// ==================== 时效管理 ====================

/**
 * 计算记忆年龄（天数）
 * @param {number} timestamp - 时间戳（毫秒）
 * @returns {number} 天数
 */
function memoryAgeDays(timestamp) {
  const now = Date.now();
  const age = Math.floor((now - timestamp) / (24 * 60 * 60 * 1000));
  return Math.max(0, age);
}

/**
 * 获取人类可读的时效描述
 * @param {number} timestamp - 时间戳
 * @returns {string} 描述
 */
function memoryAgeText(timestamp) {
  const days = memoryAgeDays(timestamp);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * 获取时效警告
 * @param {number} timestamp - 时间戳
 * @returns {string|null} 警告文本或null
 */
function memoryFreshnessWarning(timestamp) {
  const days = memoryAgeDays(timestamp);
  
  // 1天内不警告
  if (days <= 1) return null;
  
  let level = '';
  if (days <= 7) level = '⚠️';
  else if (days <= 30) level = '🔴';
  else level = '⚫';
  
  return `${level} <system-reminder>This memory is ${days} days old. 
Memories are point-in-time observations, not live state — 
claims about code behavior or file:line citations may be outdated. 
Verify against current code before asserting as fact.</system-reminder>`;
}

/**
 * 获取时效等级
 * @param {number} timestamp - 时间戳
 * @returns {'fresh'|'normal'|'old'|'stale'} 等级
 */
function getFreshnessLevel(timestamp) {
  const days = memoryAgeDays(timestamp);
  if (days <= CONFIG.freshness.fresh) return 'fresh';
  if (days <= CONFIG.freshness.normal) return 'normal';
  if (days <= CONFIG.freshness.old) return 'old';
  return 'stale';
}

// ==================== 记忆管理器 ====================

class MemoryManager {
  constructor(baseDir = CONFIG.baseDir) {
    this.baseDir = baseDir;
    this.ensureDirectories();
    
    // 初始化向量存储
    this.vectorStore = new VectorStore(baseDir, {
      similarityThreshold: 0.05  // 较低的阈值以支持模糊匹配
    });
  }
  
  /**
   * 确保目录结构存在
   */
  ensureDirectories() {
    const dirs = [
      this.baseDir,
      path.join(this.baseDir, 'auto'),
      path.join(this.baseDir, 'user'),
      path.join(this.baseDir, 'task'),
      path.join(this.baseDir, 'logs', new Date().getFullYear().toString(), 
                String(new Date().getMonth() + 1).padStart(2, '0'))
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }
  
  /**
   * 生成记忆ID
   * @returns {string}
   */
  generateId() {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2, 8);
    return `MEM-${dateStr}-${random}`;
  }
  
  /**
   * 获取每日日志路径
   * @param {Date} [date] - 日期，默认为今天
   * @returns {string}
   */
  getDailyLogPath(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dir = path.join(this.baseDir, 'logs', String(year), month);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    return path.join(dir, `${year}-${month}-${day}.md`);
  }
  
  /**
   * 创建记忆
   * @param {Object} params - 参数
   * @param {'auto'|'user'|'task'} params.type - 记忆类型
   * @param {string} params.content - 内容
   * @param {string} [params.title] - 标题
   * @param {string[]} [params.tags] - 标签
   * @param {string} [params.source] - 来源
   * @returns {Memory}
   */
  create({ type, content, title, tags = [], source }) {
    const now = Date.now();
    const memory = {
      id: this.generateId(),
      type,
      content,
      title: title || `Memory ${new Date().toLocaleString('zh-CN')}`,
      created: now,
      modified: now,
      tags,
      source: source || 'conversation'
    };
    
    // 保存到对应目录
    const filePath = this.getMemoryFilePath(memory);
    this.saveMemoryFile(filePath, memory);
    
    // 添加到向量索引（用于语义搜索）
    this.vectorStore.add(memory.id, memory.content, {
      title: memory.title,
      type: memory.type,
      tags: memory.tags,
      created: memory.created
    });
    
    // 同时追加到每日日志
    this.appendToDailyLog(memory);
    
    return memory;
  }
  
  /**
   * 获取记忆文件路径
   * @param {Memory} memory - 记忆对象
   * @returns {string}
   */
  getMemoryFilePath(memory) {
    const dir = path.join(this.baseDir, CONFIG.types[memory.type] || 'auto');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, `${memory.id}.md`);
  }
  
  /**
   * 保存记忆文件
   * @param {string} filePath - 文件路径
   * @param {Memory} memory - 记忆对象
   */
  saveMemoryFile(filePath, memory) {
    const content = this.formatMemoryToMarkdown(memory);
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  
  /**
   * 格式化为 Markdown
   * @param {Memory} memory - 记忆对象
   * @returns {string}
   */
  formatMemoryToMarkdown(memory) {
    const date = new Date(memory.created);
    const dateStr = date.toISOString();
    
    return `---
id: ${memory.id}
type: ${memory.type}
created: ${dateStr}
modified: ${new Date(memory.modified).toISOString()}
tags: [${memory.tags.join(', ')}]
source: ${memory.source}
---

# ${memory.title}

**时间**: ${date.toLocaleString('zh-CN')}
**时效**: ${memoryAgeText(memory.created)}

## 内容

${memory.content}

---
*Type: ${memory.type} | Created: ${memoryAgeText(memory.created)}*
`;
  }
  
  /**
   * 追加到每日日志
   * @param {Memory} memory - 记忆对象
   */
  appendToDailyLog(memory) {
    const logPath = this.getDailyLogPath();
    const timeStr = new Date(memory.created).toLocaleTimeString('zh-CN');
    
    const entry = `
## ${timeStr} [${memory.type}]

**${memory.title}**

${memory.content}

---
`;
    
    // 如果日志文件不存在，先创建头部
    if (!fs.existsSync(logPath)) {
      const header = `# Daily Log - ${new Date().toISOString().slice(0, 10)}\n\n`;
      fs.writeFileSync(logPath, header, 'utf-8');
    }
    
    fs.appendFileSync(logPath, entry, 'utf-8');
  }
  
  /**
   * 加载所有记忆
   * @returns {Memory[]}
   */
  loadAll() {
    const memories = [];
    const types = ['auto', 'user', 'task'];
    
    types.forEach(type => {
      const dir = path.join(this.baseDir, type);
      if (!fs.existsSync(dir)) return;
      
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      files.forEach(file => {
        const filePath = path.join(dir, file);
        try {
          const memory = this.parseMemoryFile(filePath);
          if (memory) memories.push(memory);
        } catch (e) {
          console.error(`Failed to parse memory: ${filePath}`, e.message);
        }
      });
    });
    
    return memories;
  }
  
  /**
   * 解析记忆文件
   * @param {string} filePath - 文件路径
   * @returns {Memory|null}
   */
  parseMemoryFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // 解析 YAML frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;
    
    const frontmatter = match[1];
    const body = match[2];
    
    // 简单解析
    const meta = {};
    frontmatter.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        let value = valueParts.join(':').trim();
        // 去除数组括号
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
        }
        meta[key.trim()] = value;
      }
    });
    
    // 提取标题
    const titleMatch = body.match(/^# (.+)$/m);
    const title = titleMatch ? titleMatch[1] : 'Untitled';
    
    // 提取内容（在"## 内容"之后）
    const contentMatch = body.match(/## 内容\n\n([\s\S]*?)\n\n---/);
    const memoryContent = contentMatch ? contentMatch[1].trim() : body.trim();
    
    return {
      id: meta.id || path.basename(filePath, '.md'),
      type: meta.type || 'auto',
      title,
      content: memoryContent,
      created: new Date(meta.created || Date.now()).getTime(),
      modified: new Date(meta.modified || meta.created || Date.now()).getTime(),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      source: meta.source || 'unknown'
    };
  }
  
  /**
   * 检索相关记忆（带排序）
   * @param {Object} options - 选项
   * @param {string} [options.query] - 查询关键词
   * @param {string[]} [options.types] - 类型过滤
   * @param {number} [options.maxAge] - 最大年龄（天）
   * @param {number} [options.limit] - 返回数量限制
   * @returns {Memory[]}
   */
  findRelevant({ query, types, maxAge, limit = 10 } = {}) {
    let memories = this.loadAll();
    
    // 类型过滤
    if (types && types.length > 0) {
      memories = memories.filter(m => types.includes(m.type));
    }
    
    // 年龄过滤
    if (maxAge !== undefined) {
      const cutoff = Date.now() - (maxAge * 24 * 60 * 60 * 1000);
      memories = memories.filter(m => m.created >= cutoff);
    }
    
    // 关键词过滤
    if (query) {
      const queryLower = query.toLowerCase();
      memories = memories.filter(m => 
        m.content.toLowerCase().includes(queryLower) ||
        m.title.toLowerCase().includes(queryLower) ||
        m.tags.some(t => t.toLowerCase().includes(queryLower))
      );
    }
    
    // 排序：类型优先级 > 时效 > 时间
    memories.sort((a, b) => {
      // 类型优先级
      const typePriority = { user: 0, task: 1, auto: 2, daily: 3 };
      const priorityDiff = (typePriority[a.type] || 4) - (typePriority[b.type] || 4);
      if (priorityDiff !== 0) return priorityDiff;
      
      // 时效性（新的优先）
      const ageA = memoryAgeDays(a.created);
      const ageB = memoryAgeDays(b.created);
      if (ageA !== ageB) return ageA - ageB;
      
      // 时间倒序
      return b.created - a.created;
    });
    
    return memories.slice(0, limit);
  }
  
  /**
   * 格式化记忆用于展示（自动附加时效警告）
   * @param {Memory} memory - 记忆对象
   * @returns {string}
   */
  format(memory) {
    const warning = memoryFreshnessWarning(memory.created);
    const age = memoryAgeText(memory.created);
    
    const parts = [];
    if (warning) parts.push(warning);
    parts.push(`[${memory.type} memory - ${age}]`);
    parts.push(`**${memory.title}**`);
    parts.push(memory.content);
    if (memory.tags.length > 0) {
      parts.push(`Tags: ${memory.tags.join(', ')}`);
    }
    
    return parts.join('\n\n');
  }
  
  /**
   * 获取今日记忆摘要
   * @returns {string}
   */
  getTodaySummary() {
    const today = new Date().toISOString().slice(0, 10);
    const logPath = this.getDailyLogPath();
    
    if (!fs.existsSync(logPath)) {
      return `今日 (${today}) 暂无记忆记录。`;
    }
    
    const content = fs.readFileSync(logPath, 'utf-8');
    const entries = content.split('---').filter(e => e.trim());
    
    return `今日 (${today}) 共有 ${entries.length - 1} 条记忆记录。\n\n` + 
           content.slice(0, 2000) + (content.length > 2000 ? '\n\n... (truncated)' : '');
  }
  
  /**
   * 语义搜索 - 基于向量相似度的记忆检索
   * 支持模糊匹配和同义词，例如搜索"简报"会匹配"新闻汇总"、"每日报告"
   * @param {Object} options - 选项
   * @param {string} options.query - 查询文本
   * @param {number} [options.limit=10] - 返回结果数
   * @param {number} [options.threshold=0.1] - 相似度阈值
   * @param {string[]} [options.types] - 类型过滤
   * @returns {Array} 搜索结果，包含 similarity 分数
   */
  semanticSearch({ query, limit = 10, threshold = 0.1, types } = {}) {
    // 执行向量搜索
    const results = this.vectorStore.search(query, {
      topK: limit,
      threshold,
      filterTypes: types || []
    });
    
    return results.map(r => ({
      id: r.id,
      type: r.type,
      title: r.title,
      content: r.content,
      tags: r.tags,
      created: r.created,
      similarity: r.similarity,
      age: memoryAgeText(r.created),
      freshnessLevel: getFreshnessLevel(r.created)
    }));
  }
  
  /**
   * 混合搜索 - 结合关键词搜索和语义搜索
   * @param {Object} options - 选项
   * @param {string} options.query - 查询文本
   * @param {number} [options.limit=10] - 返回结果数
   * @returns {Array} 搜索结果
   */
  hybridSearch({ query, limit = 10 } = {}) {
    // 同时进行关键词搜索和语义搜索
    const keywordResults = this.findRelevant({ query, limit: limit * 2 });
    const semanticResults = this.semanticSearch({ query, limit: limit * 2 });
    
    // 创建 ID -> 结果的映射
    const resultMap = new Map();
    
    // 添加关键词搜索结果
    keywordResults.forEach((m, index) => {
      resultMap.set(m.id, {
        ...m,
        keywordRank: index,
        semanticRank: Infinity,
        similarity: 0
      });
    });
    
    // 添加语义搜索结果
    semanticResults.forEach((r, index) => {
      if (resultMap.has(r.id)) {
        const existing = resultMap.get(r.id);
        existing.semanticRank = index;
        existing.similarity = r.similarity;
      } else {
        resultMap.set(r.id, {
          ...r,
          keywordRank: Infinity,
          semanticRank: index
        });
      }
    });
    
    // 合并排序：同时出现在两种结果中的优先
    const combined = Array.from(resultMap.values());
    combined.sort((a, b) => {
      const scoreA = (a.keywordRank === Infinity ? 100 : a.keywordRank) + 
                     (a.semanticRank === Infinity ? 100 : a.semanticRank * 0.5);
      const scoreB = (b.keywordRank === Infinity ? 100 : b.keywordRank) + 
                     (b.semanticRank === Infinity ? 100 : b.semanticRank * 0.5);
      return scoreA - scoreB;
    });
    
    return combined.slice(0, limit);
  }
  
  /**
   * 重建向量索引
   * 用于批量导入后或索引损坏时重建
   * @returns {Object} 统计信息
   */
  rebuildVectorIndex() {
    console.log('[MemoryManager] 开始重建向量索引...');
    
    const memories = this.loadAll();
    const stats = this.vectorStore.rebuildIndex(memories);
    
    console.log(`[MemoryManager] 向量索引重建完成: ${stats.vectorCount} 条向量, ${stats.vocabularySize} 个词`);
    return stats;
  }
  
  /**
   * 获取向量存储统计信息
   * @returns {Object}
   */
  getVectorStats() {
    return this.vectorStore.getStats();
  }
}

// ==================== 导出 ====================

module.exports = {
  MemoryManager,
  memoryAgeDays,
  memoryAgeText,
  memoryFreshnessWarning,
  getFreshnessLevel,
  CONFIG
};

// 如果直接运行，执行测试
if (require.main === module) {
  console.log('Memory System - Test Mode\n');
  
  const manager = new MemoryManager();
  
  // 创建测试记忆
  console.log('Creating test memories...');
  
  const mem1 = manager.create({
    type: 'user',
    content: '用户偏好技术流风格的简报，要求包含技术原理、架构设计、实现细节。',
    title: '用户简报风格偏好',
    tags: ['偏好', '简报', '风格'],
    source: 'user_instruction'
  });
  console.log('Created:', mem1.id);
  
  const mem2 = manager.create({
    type: 'auto',
    content: '检测到用户每天8点需要三份简报（金融、软科、硬科）。',
    title: '用户日常习惯',
    tags: ['习惯', '简报', '定时任务'],
    source: 'conversation'
  });
  console.log('Created:', mem2.id);
  
  const mem3 = manager.create({
    type: 'user',
    content: '用户喜欢看包含技术细节的新闻汇总和分析报告。',
    title: '用户阅读偏好',
    tags: ['偏好', '新闻', '报告'],
    source: 'conversation'
  });
  console.log('Created:', mem3.id);
  
  const mem4 = manager.create({
    type: 'task',
    content: '完成每日金融动态报告的自动生成任务。',
    title: '每日报告任务',
    tags: ['任务', '报告', '金融'],
    source: 'task_assignment'
  });
  console.log('Created:', mem4.id);
  
  // 传统关键词搜索
  console.log('\n\n=== 传统关键词搜索 (query: 简报) ===');
  const keywordResults = manager.findRelevant({ query: '简报', limit: 5 });
  keywordResults.forEach(m => {
    console.log(`- [${m.type}] ${m.title}`);
  });
  
  // 语义搜索
  console.log('\n\n=== 语义搜索 (query: 简报) ===');
  const semanticResults = manager.semanticSearch({ query: '简报', limit: 5 });
  semanticResults.forEach(r => {
    console.log(`- [${r.type}] ${r.title} (相似度: ${r.similarity.toFixed(3)})`);
  });
  
  // 测试同义词匹配
  console.log('\n\n=== 语义搜索 - 同义词测试 ===');
  const synonymQueries = [
    { query: '每日报告', expected: '应匹配"简报"相关记忆' },
    { query: '新闻汇总', expected: '应匹配"简报"相关记忆' },
    { query: '技术风格', expected: '应匹配"技术流风格"' }
  ];
  
  synonymQueries.forEach(({ query, expected }) => {
    console.log(`\n查询: "${query}" (${expected})`);
    const results = manager.semanticSearch({ query, limit: 3 });
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.type}] ${r.title} (相似度: ${r.similarity.toFixed(3)})`);
    });
  });
  
  // 混合搜索
  console.log('\n\n=== 混合搜索 (query: 简报) ===');
  const hybridResults = manager.hybridSearch({ query: '简报', limit: 5 });
  hybridResults.forEach((r, i) => {
    console.log(`  ${i + 1}. [${r.type}] ${r.title} (相似度: ${r.similarity.toFixed(3)})`);
  });
  
  // 统计信息
  console.log('\n\n=== 向量存储统计 ===');
  console.log(manager.getVectorStats());
  
  console.log('\nDone!');
}
