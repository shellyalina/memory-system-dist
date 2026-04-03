/**
 * Memory System v2.0 - Full Integration
 * 
 * 整合所有 P1 阶段功能：
 * - 核心记忆管理 (MemoryManager)
 * - 后台提取 (MemoryExtractor)
 * - 向量检索 (VectorStore)
 * - 自动压缩 (MemoryCompressor)
 */

const { MemoryManager } = require('./memoryManager.js');
const { MemoryExtractor, BackgroundExtractor } = require('./extractor.js');
const { SimpleEmbedding, VectorStore } = require('./vectorStore.js');
const { MemoryCompressor } = require('./compressor.js');
const { PriorityManager } = require('./priorityPlugin.js');

/**
 * 增强版记忆管理器 - 集成所有功能
 */
class EnhancedMemoryManager extends MemoryManager {
  constructor(options = {}) {
    super(options.baseDir);
    
    // 初始化向量存储
    const vectorIndexPath = options.vectorIndexPath || `${this.baseDir}/vector-index.json`;
    this.vectorStore = new VectorStore(vectorIndexPath);
    this.vectorStore.loadIndex();
    
    // 初始化提取器
    this.extractor = new MemoryExtractor({
      sensitivity: options.extractionSensitivity || 'medium'
    });
    
    // 初始化压缩器
    this.compressor = new MemoryCompressor(this, {
      autoCompressThreshold: options.autoCompressThreshold || 100
    });
    
    // 后台提取器（可选）
    this.backgroundExtractor = null;
    if (options.enableBackgroundExtraction) {
      this.backgroundExtractor = new BackgroundExtractor({
        interval: options.extractionInterval || 60000,
        manager: this
      });
    }
    
    // 自动压缩检查
    this.autoCompressEnabled = options.enableAutoCompress !== false;
    
    // 初始化优先级管理器（新增）
    this.priorityManager = new PriorityManager(this);
  }
  
  /**
   * 创建记忆（增强版 - 自动更新向量索引）
   */
  create(params) {
    const memory = super.create(params);
    
    // 自动添加到向量索引
    try {
      const embedding = new SimpleEmbedding().embed(memory.content);
      this.vectorStore.add(memory.id, embedding, {
        type: memory.type,
        tags: memory.tags,
        timestamp: memory.created
      });
      this.vectorStore.saveIndex();
    } catch (e) {
      console.error('Failed to add to vector index:', e.message);
    }
    
    // 检查是否需要自动压缩
    if (this.autoCompressEnabled) {
      this.checkAndCompress();
    }
    
    return memory;
  }
  
  /**
   * 语义搜索
   */
  semanticSearch(query, options = {}) {
    const embedding = new SimpleEmbedding().embed(query);
    return this.vectorStore.search(embedding, {
      topK: options.limit || 10,
      threshold: options.threshold || 0.3,
      filter: options.type ? m => m.type === options.type : undefined
    });
  }
  
  /**
   * 混合搜索（关键词 + 语义）
   */
  hybridSearch(query, options = {}) {
    // 1. 传统关键词搜索
    const keywordResults = this.findRelevant({
      query,
      types: options.types,
      maxAge: options.maxAge,
      limit: options.limit || 20
    });
    
    // 2. 语义搜索
    const semanticResults = this.semanticSearch(query, {
      limit: options.limit || 20,
      threshold: options.semanticThreshold || 0.2
    });
    
    // 3. 合并并去重
    const merged = new Map();
    
    keywordResults.forEach((m, i) => {
      merged.set(m.id, {
        memory: m,
        keywordScore: 1 - (i * 0.05),
        semanticScore: 0
      });
    });
    
    semanticResults.forEach((r, i) => {
      if (merged.has(r.id)) {
        merged.get(r.id).semanticScore = r.similarity;
      } else {
        const memory = this.loadAll().find(m => m.id === r.id);
        if (memory) {
          merged.set(r.id, {
            memory,
            keywordScore: 0,
            semanticScore: r.similarity
          });
        }
      }
    });
    
    // 4. 计算混合分数并排序
    const results = Array.from(merged.values()).map(item => ({
      ...item.memory,
      hybridScore: item.keywordScore * 0.5 + item.semanticScore * 0.5
    }));
    
    results.sort((a, b) => b.hybridScore - a.hybridScore);
    
    return results.slice(0, options.limit || 10);
  }
  
  /**
   * 从对话中提取记忆
   */
  extractFromConversation(text, context = {}) {
    return this.extractor.extractAndSave(text, {
      manager: this,
      source: context.source || 'conversation',
      sessionId: context.sessionId
    });
  }
  
  /**
   * 启动后台提取
   */
  startBackgroundExtraction() {
    if (this.backgroundExtractor) {
      this.backgroundExtractor.start();
      console.log('Background memory extraction started');
    }
  }
  
  /**
   * 停止后台提取
   */
  stopBackgroundExtraction() {
    if (this.backgroundExtractor) {
      this.backgroundExtractor.stop();
      console.log('Background memory extraction stopped');
    }
  }
  
  /**
   * 检查并执行自动压缩
   */
  checkAndCompress() {
    if (this.compressor.shouldAutoCompress()) {
      console.log('Auto-compressing memories...');
      const stats = this.compressor.autoCompress();
      console.log(`Compression complete: ${stats.compressed} memories → ${stats.merged} summaries`);
      return stats;
    }
    return null;
  }
  
  /**
   * 完整压缩（手动触发）
   */
  compressAll() {
    return this.compressor.compressAll();
  }
  
  /**
   * 重建向量索引
   */
  rebuildVectorIndex() {
    const memories = this.loadAll();
    this.vectorStore.index.clear();
    
    const embedder = new SimpleEmbedding();
    memories.forEach(m => {
      try {
        const embedding = embedder.embed(m.content);
        this.vectorStore.add(m.id, embedding, {
          type: m.type,
          tags: m.tags,
          timestamp: m.created
        });
      } catch (e) {
        console.error(`Failed to embed memory ${m.id}:`, e.message);
      }
    });
    
    this.vectorStore.saveIndex();
    console.log(`Rebuilt vector index with ${memories.length} memories`);
    return memories.length;
  }
  
  /**
   * 设置记忆优先级（新增）
   * @param {string} memoryId - 记忆ID
   * @param {'high'|'normal'|'low'} priority - 优先级
   * @param {string} [reason] - 设置原因
   */
  setPriority(memoryId, priority, reason) {
    return this.priorityManager.setPriority(memoryId, priority, reason);
  }
  
  /**
   * 获取记忆优先级（新增）
   * @param {string} memoryId - 记忆ID
   */
  getPriority(memoryId) {
    return this.priorityManager.getPriority(memoryId);
  }
  
  /**
   * 按优先级排序记忆（新增）
   * @param {Array} memories - 记忆数组
   * @param {Object} options - 选项
   */
  sortByPriority(memories, options = {}) {
    return this.priorityManager.sortByPriority(memories, options);
  }
  
  /**
   * 获取高优先级记忆（新增）
   * @param {number} [limit=10] - 数量限制
   */
  getHighPriority(limit = 10) {
    return this.priorityManager.getHighPriority(limit);
  }
  
  /**
   * 获取待处理的重要事项（新增）
   * @param {number} [limit=5] - 数量限制
   */
  getPendingImportant(limit = 5) {
    return this.priorityManager.getPendingImportant(limit);
  }
  
  /**
   * 获取优先级统计（新增）
   */
  getPriorityStats() {
    return this.priorityManager.getStats();
  }
  getStats() {
    const memories = this.loadAll();
    const byType = {};
    memories.forEach(m => {
      byType[m.type] = (byType[m.type] || 0) + 1;
    });
    
    return {
      total: memories.length,
      byType,
      vectorIndexSize: this.vectorStore.getIndexSize ? this.vectorStore.getIndexSize() : 'N/A',
      lastCompress: this.compressor.getLastCompressTime ? this.compressor.getLastCompressTime() : null,
      avgFreshness: memories.length > 0 ? memories.reduce((sum, m) => {
        const days = Math.floor((Date.now() - m.created) / (24 * 60 * 60 * 1000));
        return sum + days;
      }, 0) / memories.length : 0
    };
  }
}

/**
 * 快速创建配置好的记忆管理器
 */
function createMemoryManager(options = {}) {
  return new EnhancedMemoryManager({
    baseDir: options.baseDir || '/root/.openclaw/workspace/memory-system',
    enableBackgroundExtraction: options.background || false,
    enableAutoCompress: options.autoCompress !== false,
    extractionSensitivity: options.sensitivity || 'medium',
    autoCompressThreshold: options.compressThreshold || 100,
    ...options
  });
}

module.exports = {
  EnhancedMemoryManager,
  createMemoryManager,
  // 导出所有子模块
  MemoryManager,
  MemoryExtractor,
  BackgroundExtractor,
  SimpleEmbedding,
  VectorStore,
  MemoryCompressor,
  PriorityManager
};

// 如果直接运行，执行演示
if (require.main === module) {
  console.log('Enhanced Memory System v2.0 + Priority Plugin\n');
  
  const manager = createMemoryManager();
  const stats = manager.getStats();
  
  console.log('System Stats:');
  console.log(`- Total memories: ${stats.total}`);
  console.log(`- By type:`, stats.byType);
  console.log(`- Vector index size: ${stats.vectorIndexSize}`);
  console.log(`- Average freshness: ${stats.avgFreshness.toFixed(1)} days`);
  
  // 展示优先级统计
  const priorityStats = manager.getPriorityStats();
  console.log('\nPriority Stats:');
  console.log(`- High: ${priorityStats.high}`);
  console.log(`- Normal: ${priorityStats.normal}`);
  console.log(`- Low: ${priorityStats.low}`);
  
  console.log('\n✅ Memory system with priority plugin ready!');
  console.log('\nUsage:');
  console.log('  const { createMemoryManager } = require("./integration");');
  console.log('  const memory = createMemoryManager();');
  console.log('  const mem = memory.create({ type: "user", content: "..." });');
  console.log('  memory.setPriority(mem.id, "high", "重要事项");');
  console.log('  memory.getHighPriority();');
  console.log('  memory.getPendingImportant();');
}
