/**
 * Memory Compressor - 记忆自动压缩系统
 * 
 * 功能：
 * 1. 相似记忆检测（基于内容相似度）
 * 2. 记忆合并：将相似记忆合并为一条总结
 * 3. 记忆摘要：长记忆自动提取关键信息
 * 4. 压缩历史保留（不删除原始记忆，创建压缩版本）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ==================== 配置 ====================

const COMPRESSOR_CONFIG = {
  // 相似度阈值（0-1之间，越高越严格）
  similarityThreshold: 0.75,
  
  // 长记忆阈值（字符数超过则摘要）
  longMemoryThreshold: 500,
  
  // 自动压缩触发阈值（记忆条数）
  autoCompressThreshold: 100,
  
  // 时间窗口（毫秒）- 默认7天
  timeWindowMs: 7 * 24 * 60 * 60 * 1000,
  
  // 短记忆阈值（字符数少于则合并）
  shortMemoryThreshold: 100,
  
  // 压缩文件存储目录
  compressedDir: 'compressed',
  
  // 压缩历史文件
  historyFile: 'compression-history.json',
  
  // 停用词（用于相似度计算）
  stopWords: new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '这些', '那些', '之', '与', '及', '等', '或', '但', '而', '因为', '所以', '如果', '虽然', '然而', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while'
  ])
};

// ==================== 压缩模板 ====================

const TEMPLATES = {
  /**
   * 合并模板
   * @param {number} count - 合并的记忆数量
   * @param {string} topic - 主题
   * @param {string} summary - 摘要内容
   * @returns {string}
   */
  merge: (count, topic, summary) => `【合并】${count}条关于"${topic}"的记忆: ${summary}`,
  
  /**
   * 摘要模板
   * @param {string} originalTitle - 原标题
   * @param {string} keyInfo - 关键信息
   * @returns {string}
   */
  summary: (originalTitle, keyInfo) => `【摘要】${originalTitle}: ${keyInfo}`,
  
  /**
   * 时间窗口合并模板
   * @param {string} timeRange - 时间范围
   * @param {string} topic - 主题
   * @param {number} count - 数量
   * @returns {string}
   */
  timeWindowMerge: (timeRange, topic, count) => `【${timeRange}合并】${count}条关于"${topic}"的记忆已整合`,
  
  /**
   * 标签压缩模板
   * @param {string} tag - 标签
   * @param {number} count - 数量
   * @param {string} summary - 摘要
   * @returns {string}
   */
  tagCompress: (tag, count, summary) => `【${tag}标签压缩】${count}条相关记忆: ${summary}`,
  
  /**
   * 类型压缩模板
   * @param {string} type - 类型
   * @param {number} count - 数量
   * @param {string} summary - 摘要
   * @returns {string}
   */
  typeCompress: (type, count, summary) => `【${type}类型压缩】${count}条记忆已优化: ${summary}`
};

// ==================== 文本相似度计算 ====================

/**
 * 分词（简单实现：按非字母数字字符分割）
 * @param {string} text - 文本
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];
  
  // 转换为小写，去除标点
  const normalized = text.toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, ' ')
    .trim();
  
  // 中文逐字分词，英文按空格分词
  const tokens = [];
  for (const char of normalized) {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      // 中文字符
      if (!COMPRESSOR_CONFIG.stopWords.has(char)) {
        tokens.push(char);
      }
    } else if (char === ' ') {
      continue;
    } else {
      tokens.push(char);
    }
  }
  
  // 处理英文单词
  const words = normalized.split(/\s+/).filter(w => w.length > 1);
  words.forEach(word => {
    if (!COMPRESSOR_CONFIG.stopWords.has(word)) {
      tokens.push(word);
    }
  });
  
  return tokens;
}

/**
 * 计算词频向量
 * @param {string[]} tokens - 词列表
 * @returns {Map<string, number>}
 */
function calculateTermFrequency(tokens) {
  const tf = new Map();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  return tf;
}

/**
 * 计算余弦相似度
 * @param {string} text1 - 文本1
 * @param {string} text2 - 文本2
 * @returns {number} 相似度（0-1）
 */
function calculateSimilarity(text1, text2) {
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);
  
  if (tokens1.length === 0 || tokens2.length === 0) return 0;
  
  const tf1 = calculateTermFrequency(tokens1);
  const tf2 = calculateTermFrequency(tokens2);
  
  // 构建词汇表
  const vocab = new Set([...tf1.keys(), ...tf2.keys()]);
  
  // 计算点积
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (const term of vocab) {
    const v1 = tf1.get(term) || 0;
    const v2 = tf2.get(term) || 0;
    dotProduct += v1 * v2;
  }
  
  for (const count of tf1.values()) {
    norm1 += count * count;
  }
  
  for (const count of tf2.values()) {
    norm2 += count * count;
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * 基于标签计算相似度
 * @param {string[]} tags1 - 标签列表1
 * @param {string[]} tags2 - 标签列表2
 * @returns {number}
 */
function calculateTagSimilarity(tags1, tags2) {
  if (!tags1 || !tags2 || tags1.length === 0 || tags2.length === 0) return 0;
  
  const set1 = new Set(tags1.map(t => t.toLowerCase()));
  const set2 = new Set(tags2.map(t => t.toLowerCase()));
  
  const intersection = [...set1].filter(x => set2.has(x));
  const union = new Set([...set1, ...set2]);
  
  return intersection.length / union.size;
}

/**
 * 综合相似度计算
 * @param {Object} memory1 - 记忆1
 * @param {Object} memory2 - 记忆2
 * @returns {number}
 */
function calculateMemorySimilarity(memory1, memory2) {
  // 内容相似度（权重0.6）
  const contentSim = calculateSimilarity(
    memory1.content + ' ' + memory1.title,
    memory2.content + ' ' + memory2.title
  );
  
  // 标签相似度（权重0.3）
  const tagSim = calculateTagSimilarity(memory1.tags, memory2.tags);
  
  // 类型相同（权重0.1）
  const typeSim = memory1.type === memory2.type ? 1 : 0;
  
  return contentSim * 0.6 + tagSim * 0.3 + typeSim * 0.1;
}

// ==================== 记忆摘要 ====================

/**
 * 提取关键句子（基于TF-IDF的简单实现）
 * @param {string} text - 文本
 * @param {number} sentenceCount - 返回的句子数
 * @returns {string}
 */
function extractKeySentences(text, sentenceCount = 2) {
  // 简单分句
  const sentences = text.split(/[。！？.!?]+/).filter(s => s.trim().length > 5);
  
  if (sentences.length <= sentenceCount) return text;
  
  // 计算每句的词频
  const sentenceScores = sentences.map(sentence => {
    const tokens = tokenize(sentence);
    const uniqueTokens = new Set(tokens);
    // 分数 = 独特词数 / 总词数 * 句子长度因子
    const score = (uniqueTokens.size / Math.max(tokens.length, 1)) * Math.log(tokens.length + 1);
    return { sentence: sentence.trim(), score, length: tokens.length };
  });
  
  // 按分数排序，取前N句
  sentenceScores.sort((a, b) => b.score - a.score);
  const topSentences = sentenceScores.slice(0, sentenceCount);
  
  // 按原文顺序排列
  topSentences.sort((a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence));
  
  return topSentences.map(s => s.sentence).join('。') + '。';
}

/**
 * 提取关键词
 * @param {string} text - 文本
 * @param {number} count - 关键词数量
 * @returns {string[]}
 */
function extractKeywords(text, count = 5) {
  const tokens = tokenize(text);
  const tf = calculateTermFrequency(tokens);
  
  // 按频率排序
  const sorted = [...tf.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, count).map(([word]) => word);
}

/**
 * 提取主题
 * @param {Object[]} memories - 记忆列表
 * @returns {string}
 */
function extractTopic(memories) {
  if (memories.length === 0) return '未知主题';
  if (memories.length === 1) return memories[0].title || '未命名';
  
  // 合并所有内容提取关键词
  const allText = memories.map(m => m.content + ' ' + m.title).join(' ');
  const keywords = extractKeywords(allText, 3);
  
  if (keywords.length === 0) return '相关记忆';
  return keywords.join('、');
}

/**
 * 生成摘要内容
 * @param {Object[]} memories - 记忆列表
 * @returns {string}
 */
function generateSummary(memories) {
  if (memories.length === 0) return '';
  
  // 提取每个记忆的关键点
  const keyPoints = memories.map(m => {
    const summary = extractKeySentences(m.content, 1);
    return summary.slice(0, 50) + (summary.length > 50 ? '...' : '');
  });
  
  // 去重并合并
  const uniquePoints = [...new Set(keyPoints)];
  
  if (uniquePoints.length === 1) {
    return uniquePoints[0];
  }
  
  return uniquePoints.slice(0, 3).join(' | ');
}

// ==================== 压缩历史管理 ====================

class CompressionHistory {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.historyPath = path.join(baseDir, COMPRESSOR_CONFIG.historyFile);
    this.load();
  }
  
  load() {
    if (fs.existsSync(this.historyPath)) {
      try {
        this.history = JSON.parse(fs.readFileSync(this.historyPath, 'utf-8'));
      } catch (e) {
        this.history = { compressions: [], stats: {} };
      }
    } else {
      this.history = { compressions: [], stats: {} };
    }
  }
  
  save() {
    fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2), 'utf-8');
  }
  
  record(compression) {
    const record = {
      id: `COMP-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      timestamp: Date.now(),
      ...compression
    };
    this.history.compressions.unshift(record);
    
    // 只保留最近100条记录
    if (this.history.compressions.length > 100) {
      this.history.compressions = this.history.compressions.slice(0, 100);
    }
    
    this.save();
    return record;
  }
  
  getStats() {
    return this.history.stats;
  }
  
  updateStats(type, count) {
    if (!this.history.stats[type]) {
      this.history.stats[type] = 0;
    }
    this.history.stats[type] += count;
    this.save();
  }
  
  getCompressedMemoryIds() {
    const ids = new Set();
    this.history.compressions.forEach(comp => {
      if (comp.sourceIds) {
        comp.sourceIds.forEach(id => ids.add(id));
      }
    });
    return ids;
  }
}

// ==================== 记忆压缩器 ====================

class MemoryCompressor {
  constructor(memoryManager) {
    this.memoryManager = memoryManager;
    this.baseDir = memoryManager.baseDir;
    this.history = new CompressionHistory(this.baseDir);
    this.compressedDir = path.join(this.baseDir, COMPRESSOR_CONFIG.compressedDir);
    this.ensureDirectories();
  }
  
  ensureDirectories() {
    if (!fs.existsSync(this.compressedDir)) {
      fs.mkdirSync(this.compressedDir, { recursive: true });
    }
  }
  
  /**
   * 查找相似记忆组
   * @param {Object[]} memories - 记忆列表
   * @param {number} threshold - 相似度阈值
   * @returns {Object[][]} 相似记忆组
   */
  findSimilarGroups(memories, threshold = COMPRESSOR_CONFIG.similarityThreshold) {
    const groups = [];
    const used = new Set();
    
    for (let i = 0; i < memories.length; i++) {
      if (used.has(i)) continue;
      
      const group = [memories[i]];
      used.add(i);
      
      for (let j = i + 1; j < memories.length; j++) {
        if (used.has(j)) continue;
        
        const similarity = calculateMemorySimilarity(memories[i], memories[j]);
        
        if (similarity >= threshold) {
          group.push(memories[j]);
          used.add(j);
        }
      }
      
      // 只保留大小>=2的组
      if (group.length >= 2) {
        groups.push(group);
      }
    }
    
    return groups;
  }
  
  /**
   * 按时间窗口分组
   * @param {Object[]} memories - 记忆列表
   * @param {number} windowMs - 时间窗口（毫秒）
   * @returns {Object[][]}
   */
  groupByTimeWindow(memories, windowMs = COMPRESSOR_CONFIG.timeWindowMs) {
    const sorted = [...memories].sort((a, b) => a.created - b.created);
    const groups = [];
    
    let currentGroup = [];
    let windowStart = null;
    
    for (const memory of sorted) {
      if (windowStart === null) {
        windowStart = memory.created;
        currentGroup = [memory];
      } else if (memory.created - windowStart <= windowMs) {
        currentGroup.push(memory);
      } else {
        if (currentGroup.length >= 2) {
          groups.push(currentGroup);
        }
        windowStart = memory.created;
        currentGroup = [memory];
      }
    }
    
    if (currentGroup.length >= 2) {
      groups.push(currentGroup);
    }
    
    return groups;
  }
  
  /**
   * 按标签分组
   * @param {Object[]} memories - 记忆列表
   * @returns {Map<string, Object[]>}
   */
  groupByTags(memories) {
    const groups = new Map();
    
    for (const memory of memories) {
      if (!memory.tags || memory.tags.length === 0) continue;
      
      for (const tag of memory.tags) {
        if (!groups.has(tag)) {
          groups.set(tag, []);
        }
        groups.get(tag).push(memory);
      }
    }
    
    // 过滤掉只有一条记忆的标签组
    const result = new Map();
    for (const [tag, group] of groups) {
      if (group.length >= 2) {
        result.set(tag, group);
      }
    }
    
    return result;
  }
  
  /**
   * 按类型分组
   * @param {Object[]} memories - 记忆列表
   * @returns {Map<string, Object[]>}
   */
  groupByType(memories) {
    const groups = new Map();
    
    for (const memory of memories) {
      const type = memory.type || 'unknown';
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type).push(memory);
    }
    
    return groups;
  }
  
  /**
   * 创建压缩记忆
   * @param {Object} params - 参数
   * @returns {Object}
   */
  createCompressedMemory({ type, title, content, tags, sourceIds, compressType, originalMemories }) {
    const now = Date.now();
    const id = `COMP-${now}-${Math.random().toString(36).substring(2, 8)}`;
    
    const compressed = {
      id,
      type,
      title,
      content,
      created: now,
      modified: now,
      tags: [...new Set([...(tags || []), 'compressed', compressType])],
      source: 'compression',
      metadata: {
        compressType,
        sourceCount: sourceIds.length,
        sourceIds,
        originalCreated: originalMemories.map(m => m.created),
        compressedAt: now
      }
    };
    
    // 保存到压缩目录
    const filePath = path.join(this.compressedDir, `${id}.md`);
    const markdown = this.formatCompressedMemory(compressed, originalMemories);
    fs.writeFileSync(filePath, markdown, 'utf-8');
    
    // 记录历史
    this.history.record({
      compressedId: id,
      sourceIds,
      compressType,
      title,
      timestamp: now
    });
    
    return compressed;
  }
  
  /**
   * 格式化压缩记忆为 Markdown
   * @param {Object} compressed - 压缩记忆
   * @param {Object[]} originals - 原始记忆列表
   * @returns {string}
   */
  formatCompressedMemory(compressed, originals) {
    const originalDetails = originals.map(m => 
      `- ${m.id}: ${m.title} (${new Date(m.created).toLocaleString('zh-CN')})`
    ).join('\n');
    
    const originalContents = originals.map(m => 
      `### ${m.title}\n${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`
    ).join('\n\n');
    
    return `---
id: ${compressed.id}
type: ${compressed.type}
created: ${new Date(compressed.created).toISOString()}
modified: ${new Date(compressed.modified).toISOString()}
tags: [${compressed.tags.join(', ')}]
source: compression
compress_type: ${compressed.metadata.compressType}
source_count: ${compressed.metadata.sourceCount}
source_ids: [${compressed.metadata.sourceIds.join(', ')}]
---

# ${compressed.title}

**压缩时间**: ${new Date(compressed.created).toLocaleString('zh-CN')}
**压缩类型**: ${compressed.metadata.compressType}
**原始记忆数**: ${compressed.metadata.sourceCount}

## 压缩内容

${compressed.content}

## 原始记忆列表

${originalDetails}

## 原始内容备份

<details>
<summary>展开查看原始内容</summary>

${originalContents}

</details>

---
*此记忆由自动压缩系统生成，原始记忆仍保留在原位置*
`;
  }
  
  /**
   * 执行相似记忆合并
   * @param {Object[]} memories - 记忆列表（可选，默认加载所有）
   * @returns {Object[]}
   */
  compressBySimilarity(memories = null) {
    const targetMemories = memories || this.memoryManager.loadAll();
    const groups = this.findSimilarGroups(targetMemories);
    const results = [];
    
    for (const group of groups) {
      const topic = extractTopic(group);
      const summary = generateSummary(group);
      const sourceIds = group.map(m => m.id);
      
      // 收集所有标签
      const allTags = group.flatMap(m => m.tags || []);
      
      const compressed = this.createCompressedMemory({
        type: group[0].type,
        title: TEMPLATES.merge(group.length, topic, summary.slice(0, 100)),
        content: summary,
        tags: allTags,
        sourceIds,
        compressType: 'similarity_merge',
        originalMemories: group
      });
      
      results.push({
        compressed,
        merged: group,
        count: group.length
      });
    }
    
    this.history.updateStats('similarity_merge', results.length);
    return results;
  }
  
  /**
   * 按时间窗口压缩
   * @param {Object[]} memories - 记忆列表（可选）
   * @param {number} windowDays - 时间窗口（天）
   * @returns {Object[]}
   */
  compressByTimeWindow(memories = null, windowDays = 7) {
    const targetMemories = memories || this.memoryManager.loadAll();
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const groups = this.groupByTimeWindow(targetMemories, windowMs);
    const results = [];
    
    for (const group of groups) {
      // 进一步按相似度分组
      const similarSubGroups = this.findSimilarGroups(group, 0.6);
      
      for (const subGroup of similarSubGroups) {
        const start = new Date(subGroup[0].created);
        const end = new Date(subGroup[subGroup.length - 1].created);
        const timeRange = `${start.toLocaleDateString('zh-CN')}~${end.toLocaleDateString('zh-CN')}`;
        
        const topic = extractTopic(subGroup);
        const summary = generateSummary(subGroup);
        const sourceIds = subGroup.map(m => m.id);
        const allTags = subGroup.flatMap(m => m.tags || []);
        
        const compressed = this.createCompressedMemory({
          type: subGroup[0].type,
          title: TEMPLATES.timeWindowMerge(timeRange, topic, subGroup.length),
          content: summary,
          tags: allTags,
          sourceIds,
          compressType: 'time_window_merge',
          originalMemories: subGroup
        });
        
        results.push({
          compressed,
          merged: subGroup,
          count: subGroup.length,
          timeRange
        });
      }
    }
    
    this.history.updateStats('time_window_merge', results.length);
    return results;
  }
  
  /**
   * 按标签压缩（短记忆）
   * @param {Object[]} memories - 记忆列表（可选）
   * @returns {Object[]}
   */
  compressByTags(memories = null) {
    const targetMemories = memories || this.memoryManager.loadAll();
    
    // 过滤出短记忆
    const shortMemories = targetMemories.filter(m => 
      (m.content || '').length < COMPRESSOR_CONFIG.shortMemoryThreshold
    );
    
    const tagGroups = this.groupByTags(shortMemories);
    const results = [];
    
    for (const [tag, group] of tagGroups) {
      const summary = generateSummary(group);
      const sourceIds = group.map(m => m.id);
      const allTags = [...new Set(group.flatMap(m => m.tags || []))];
      
      const compressed = this.createCompressedMemory({
        type: group[0].type,
        title: TEMPLATES.tagCompress(tag, group.length, summary.slice(0, 80)),
        content: summary,
        tags: allTags,
        sourceIds,
        compressType: 'tag_merge',
        originalMemories: group
      });
      
      results.push({
        compressed,
        merged: group,
        count: group.length,
        tag
      });
    }
    
    this.history.updateStats('tag_merge', results.length);
    return results;
  }
  
  /**
   * 按类型压缩（主要针对auto类型）
   * @param {Object[]} memories - 记忆列表（可选）
   * @returns {Object[]}
   */
  compressByType(memories = null) {
    const targetMemories = memories || this.memoryManager.loadAll();
    const typeGroups = this.groupByType(targetMemories);
    const results = [];
    
    // 优先处理 auto 类型
    const priorityTypes = ['auto', 'daily'];
    
    for (const type of priorityTypes) {
      const group = typeGroups.get(type);
      if (!group || group.length < 5) continue;
      
      // 按相似度分组
      const similarGroups = this.findSimilarGroups(group, 0.65);
      
      for (const subGroup of similarGroups) {
        const topic = extractTopic(subGroup);
        const summary = generateSummary(subGroup);
        const sourceIds = subGroup.map(m => m.id);
        const allTags = [...new Set(subGroup.flatMap(m => m.tags || []))];
        
        const compressed = this.createCompressedMemory({
          type,
          title: TEMPLATES.typeCompress(type, subGroup.length, summary.slice(0, 80)),
          content: summary,
          tags: allTags,
          sourceIds,
          compressType: 'type_merge',
          originalMemories: subGroup
        });
        
        results.push({
          compressed,
          merged: subGroup,
          count: subGroup.length,
          type
        });
      }
    }
    
    this.history.updateStats('type_merge', results.length);
    return results;
  }
  
  /**
   * 摘要长记忆
   * @param {Object[]} memories - 记忆列表（可选）
   * @returns {Object[]}
   */
  summarizeLongMemories(memories = null) {
    const targetMemories = memories || this.memoryManager.loadAll();
    
    // 过滤出长记忆
    const longMemories = targetMemories.filter(m => 
      (m.content || '').length > COMPRESSOR_CONFIG.longMemoryThreshold
    );
    
    const results = [];
    
    for (const memory of longMemories) {
      const keyInfo = extractKeySentences(memory.content, 2);
      const keywords = extractKeywords(memory.content, 5);
      
      const compressed = this.createCompressedMemory({
        type: memory.type,
        title: TEMPLATES.summary(memory.title, keyInfo.slice(0, 100)),
        content: `【原文摘要】\n${keyInfo}\n\n【关键词】${keywords.join('、')}\n\n---\n【原文链接】见原始记忆: ${memory.id}`,
        tags: [...(memory.tags || []), 'summarized'],
        sourceIds: [memory.id],
        compressType: 'summarization',
        originalMemories: [memory]
      });
      
      results.push({
        compressed,
        original: memory,
        keywords
      });
    }
    
    this.history.updateStats('summarization', results.length);
    return results;
  }
  
  /**
   * 执行完整压缩（所有策略）
   * @param {Object} options - 选项
   * @returns {Object}
   */
  compressAll(options = {}) {
    const {
      enableSimilarity = true,
      enableTimeWindow = true,
      enableTagMerge = true,
      enableTypeMerge = true,
      enableSummarization = true
    } = options;
    
    const allMemories = this.memoryManager.loadAll();
    const startTime = Date.now();
    const results = {
      similarity: [],
      timeWindow: [],
      tagMerge: [],
      typeMerge: [],
      summarization: [],
      totalCompressed: 0,
      duration: 0
    };
    
    // 排除已被压缩的记忆
    const compressedIds = this.history.getCompressedMemoryIds();
    const memories = allMemories.filter(m => !compressedIds.has(m.id));
    
    if (enableSimilarity) {
      results.similarity = this.compressBySimilarity(memories);
      results.totalCompressed += results.similarity.reduce((sum, r) => sum + r.count, 0);
    }
    
    if (enableTimeWindow) {
      results.timeWindow = this.compressByTimeWindow(memories);
      results.totalCompressed += results.timeWindow.reduce((sum, r) => sum + r.count, 0);
    }
    
    if (enableTagMerge) {
      results.tagMerge = this.compressByTags(memories);
      results.totalCompressed += results.tagMerge.reduce((sum, r) => sum + r.count, 0);
    }
    
    if (enableTypeMerge) {
      results.typeMerge = this.compressByType(memories);
      results.totalCompressed += results.typeMerge.reduce((sum, r) => sum + r.count, 0);
    }
    
    if (enableSummarization) {
      results.summarization = this.summarizeLongMemories(memories);
      results.totalCompressed += results.summarization.length;
    }
    
    results.duration = Date.now() - startTime;
    
    return results;
  }
  
  /**
   * 检查是否需要自动压缩
   * @returns {boolean}
   */
  shouldAutoCompress() {
    const allMemories = this.memoryManager.loadAll();
    const compressedIds = this.history.getCompressedMemoryIds();
    const uncompressedCount = allMemories.filter(m => !compressedIds.has(m.id)).length;
    
    return uncompressedCount >= COMPRESSOR_CONFIG.autoCompressThreshold;
  }
  
  /**
   * 自动压缩（超过阈值时执行）
   * @returns {Object|null}
   */
  autoCompress() {
    if (!this.shouldAutoCompress()) {
      return null;
    }
    
    console.log(`[MemoryCompressor] 触发自动压缩，记忆数量超过阈值 ${COMPRESSOR_CONFIG.autoCompressThreshold}`);
    
    const result = this.compressAll();
    
    console.log(`[MemoryCompressor] 自动压缩完成：压缩了 ${result.totalCompressed} 条记忆，耗时 ${result.duration}ms`);
    
    return result;
  }
  
  /**
   * 获取压缩统计
   * @returns {Object}
   */
  getStats() {
    const allMemories = this.memoryManager.loadAll();
    const compressedIds = this.history.getCompressedMemoryIds();
    const stats = this.history.getStats();
    
    return {
      totalMemories: allMemories.length,
      compressedMemories: compressedIds.size,
      uncompressedCount: allMemories.length - compressedIds.size,
      compressionRatio: allMemories.length > 0 ? (compressedIds.size / allMemories.length * 100).toFixed(2) + '%' : '0%',
      byType: stats,
      historyCount: this.history.history.compressions.length,
      shouldCompress: this.shouldAutoCompress()
    };
  }
  
  /**
   * 获取压缩历史
   * @param {number} limit - 限制数量
   * @returns {Object[]}
   */
  getCompressionHistory(limit = 20) {
    return this.history.history.compressions.slice(0, limit);
  }
  
  /**
   * 加载所有压缩记忆
   * @returns {Object[]}
   */
  loadCompressedMemories() {
    if (!fs.existsSync(this.compressedDir)) return [];
    
    const files = fs.readdirSync(this.compressedDir).filter(f => f.endsWith('.md'));
    const memories = [];
    
    for (const file of files) {
      const filePath = path.join(this.compressedDir, file);
      try {
        const memory = this.memoryManager.parseMemoryFile(filePath);
        if (memory) {
          memory.isCompressed = true;
          memories.push(memory);
        }
      } catch (e) {
        console.error(`[MemoryCompressor] 解析压缩记忆失败: ${file}`, e.message);
      }
    }
    
    return memories;
  }
}

// ==================== 导出 ====================

module.exports = {
  MemoryCompressor,
  calculateSimilarity,
  calculateMemorySimilarity,
  extractKeySentences,
  extractKeywords,
  extractTopic,
  generateSummary,
  TEMPLATES,
  COMPRESSOR_CONFIG
};

// 如果直接运行，执行测试
if (require.main === module) {
  console.log('Memory Compressor - Test Mode\n');
  
  // 尝试加载 memoryManager
  let MemoryManager;
  try {
    const mm = require('./memoryManager');
    MemoryManager = mm.MemoryManager;
  } catch (e) {
    console.log('警告: 无法加载 memoryManager.js，使用模拟数据进行测试');
    MemoryManager = null;
  }
  
  if (MemoryManager) {
    const manager = new MemoryManager();
    const compressor = new MemoryCompressor(manager);
    
    // 获取统计
    console.log('=== 当前压缩统计 ===');
    console.log(JSON.stringify(compressor.getStats(), null, 2));
    
    // 检查是否需要自动压缩
    console.log('\n=== 自动压缩检查 ===');
    if (compressor.shouldAutoCompress()) {
      console.log('需要自动压缩，正在执行...');
      const result = compressor.autoCompress();
      console.log('压缩结果:', JSON.stringify(result, null, 2));
    } else {
      console.log('暂不需要自动压缩');
    }
    
    // 显示使用示例
    console.log('\n=== 使用示例 ===');
    console.log(`
// 创建压缩器实例
const { MemoryCompressor } = require('./compressor');
const { MemoryManager } = require('./memoryManager');

const manager = new MemoryManager();
const compressor = new MemoryCompressor(manager);

// 手动执行相似度压缩
const similarityResults = compressor.compressBySimilarity();
console.log('合并了', similarityResults.length, '组记忆');

// 手动执行时间窗口压缩
const timeResults = compressor.compressByTimeWindow(null, 7); // 7天窗口
console.log('时间窗口压缩:', timeResults.length, '组');

// 手动执行标签压缩
const tagResults = compressor.compressByTags();
console.log('标签压缩:', tagResults.length, '组');

// 手动执行类型压缩（优先auto类型）
const typeResults = compressor.compressByType();
console.log('类型压缩:', typeResults.length, '组');

// 摘要长记忆
const summaryResults = compressor.summarizeLongMemories();
console.log('摘要了', summaryResults.length, '条长记忆');

// 执行完整压缩（所有策略）
const fullResult = compressor.compressAll();
console.log('总共压缩了', fullResult.totalCompressed, '条记忆');

// 自动压缩（超过阈值时执行）
const autoResult = compressor.autoCompress();
if (autoResult) {
  console.log('自动压缩完成');
}

// 获取统计
const stats = compressor.getStats();
console.log('压缩统计:', stats);
`);
  } else {
    // 基础功能测试
    console.log('=== 基础功能测试 ===\n');
    
    // 测试相似度计算
    const text1 = '用户喜欢技术流风格的简报，要求包含技术原理';
    const text2 = '用户偏好技术风格的报告，需要技术原理分析';
    const similarity = calculateSimilarity(text1, text2);
    console.log('相似度测试:');
    console.log('  文本1:', text1);
    console.log('  文本2:', text2);
    console.log('  相似度:', (similarity * 100).toFixed(2) + '%');
    
    // 测试摘要提取
    const longText = '这是一个很长的记忆内容。第一部分包含用户的核心需求。第二部分有一些补充说明。第三部分是可以忽略的详细描述。';
    const summary = extractKeySentences(longText, 2);
    console.log('\n摘要测试:');
    console.log('  原文:', longText.slice(0, 50) + '...');
    console.log('  摘要:', summary);
    
    // 测试关键词提取
    const keywords = extractKeywords(longText, 3);
    console.log('\n关键词测试:', keywords);
    
    // 测试模板
    console.log('\n模板测试:');
    console.log('  合并模板:', TEMPLATES.merge(5, '简报', '用户偏好技术风格'));
    console.log('  摘要模板:', TEMPLATES.summary('原始标题', '关键信息提取'));
  }
  
  console.log('\nDone!');
}