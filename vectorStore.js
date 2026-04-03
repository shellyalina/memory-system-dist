/**
 * Vector Store - 语义向量检索模块
 * 
 * 基于 TF-IDF + 余弦相似度的本地语义搜索
 * 无需外部 API，纯本地实现
 */

const fs = require('fs');
const path = require('path');

// ==================== SimpleEmbedding 类 ====================

/**
 * 简单嵌入模型 - 基于 TF-IDF 的词袋模型
 */
class SimpleEmbedding {
  constructor() {
    // 词表：词 -> 索引
    this.vocabulary = new Map();
    // IDF 值：词 -> IDF
    this.idf = new Map();
    // 文档总数
    this.documentCount = 0;
    // 词出现次数：词 -> 包含该词的文档数
    this.documentFrequency = new Map();
  }

  /**
   * 中文分词 - 简单的基于词典和规则的分词
   * @param {string} text - 输入文本
   * @returns {string[]} 分词结果
   */
  tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    
    // 1. 统一转换为小写（对中文影响不大，但处理混合文本时有用）
    const normalized = text.toLowerCase();
    
    // 2. 提取中文词语（2-4字词）和英文单词
    const tokens = [];
    
    // 中文分词：使用滑动窗口提取 2-4 字词
    // 同时结合常用词表进行更精准的分词
    const commonWords = this.getCommonWords();
    const textLen = normalized.length;
    const used = new Array(textLen).fill(false);
    
    // 先匹配常见词（最长匹配优先）
    for (let len = 6; len >= 2; len--) {
      for (let i = 0; i <= textLen - len; i++) {
        if (used.slice(i, i + len).some(u => u)) continue;
        const substr = normalized.slice(i, i + len);
        if (commonWords.has(substr)) {
          tokens.push(substr);
          for (let j = i; j < i + len; j++) used[j] = true;
        }
      }
    }
    
    // 剩余字符：提取英文单词和数字，单字也保留
    for (let i = 0; i < textLen; i++) {
      if (used[i]) continue;
      
      const char = normalized[i];
      
      // 提取英文单词
      if (/[a-z]/.test(char)) {
        let word = char;
        let j = i + 1;
        while (j < textLen && /[a-z0-9]/.test(normalized[j])) {
          word += normalized[j];
          j++;
        }
        if (word.length > 1) tokens.push(word);
        i = j - 1;
        continue;
      }
      
      // 提取数字
      if (/\d/.test(char)) {
        let num = char;
        let j = i + 1;
        while (j < textLen && /\d/.test(normalized[j])) {
          num += normalized[j];
          j++;
        }
        tokens.push(num);
        i = j - 1;
        continue;
      }
      
      // 保留中文单字（如果不是标点符号）
      if (/[\u4e00-\u9fa5]/.test(char)) {
        tokens.push(char);
      }
    }
    
    return tokens;
  }

  /**
   * 获取常见中文词汇表
   * @returns {Set<string>}
   */
  getCommonWords() {
    // 扩展词表：包含更多相关词汇以提高语义匹配效果
    const words = [
      // 基础词汇
      '用户', '偏好', '简报', '报告', '喜欢', '需要', '想要', '要求',
      '新闻', '汇总', '每日', '每天', '定时', '任务', '习惯', '风格',
      '金融', '软科', '硬科', '股票', '债券', '宏观', '经济', '黄金',
      '石油', '汇率', '软件', '硬件', '芯片', '制造', '能源', '军工',
      '航天', '医疗', '科技', '基因', '区块链', '互联网', '技术',
      
      // 工作相关
      '项目', '工作', '会议', '讨论', '决策', '计划', '进度', '完成',
      '待办', 'todo', '任务', '清单', '提醒', '通知', '邮件',
      
      // 技术相关
      '代码', '开发', '设计', '架构', '实现', '功能', '模块', '系统',
      '接口', 'api', '数据库', '服务器', '前端', '后端', '测试',
      'bug', '修复', '优化', '重构', '部署', '上线', '版本',
      
      // 时间相关
      '今天', '昨天', '明天', '上周', '下周', '本月', '上月', '今年',
      '早上', '中午', '下午', '晚上', '凌晨', '刚刚', '之前', '之后',
      
      // 状态相关
      '完成', '进行中', '待处理', '已解决', '已关闭', '已取消',
      '紧急', '重要', '高优先级', '低优先级', '一般',
      
      // 情感相关
      '喜欢', '讨厌', '觉得', '认为', '希望', '期待', '担心', '满意',
      '不满', '建议', '反馈', '评价', '体验', '感觉',
      
      // 记忆相关
      '记忆', '记住', '记录', '保存', '查询', '搜索', '检索', '回忆',
      '信息', '数据', '内容', '详情', '摘要', '总结'
    ];
    return new Set(words);
  }

  /**
   * 计算词频（TF）
   * @param {string[]} tokens - 分词结果
   * @returns {Map<string, number>} 词频映射
   */
  computeTF(tokens) {
    const tf = new Map();
    if (tokens.length === 0) return tf;
    
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }
    
    // 归一化
    for (const [word, count] of tf) {
      tf.set(word, count / tokens.length);
    }
    
    return tf;
  }

  /**
   * 更新 IDF（反向文档频率）
   * @param {string[]} tokens - 新文档的分词结果
   */
  updateIDF(tokens) {
    this.documentCount++;
    const seen = new Set(tokens);
    
    for (const token of seen) {
      this.documentFrequency.set(token, (this.documentFrequency.get(token) || 0) + 1);
    }
    
    // 重新计算所有词的 IDF
    for (const [token, df] of this.documentFrequency) {
      const idf = Math.log(this.documentCount / (df + 1)) + 1;
      this.idf.set(token, idf);
    }
  }

  /**
   * 将文本转换为向量
   * @param {string} text - 输入文本
   * @param {boolean} updateIDF - 是否更新 IDF
   * @returns {Object} 向量对象 { indices, values, magnitude }
   */
  embed(text, updateIDF = false) {
    const tokens = this.tokenize(text);
    const tf = this.computeTF(tokens);
    
    if (updateIDF) {
      this.updateIDF(tokens);
    }
    
    // 构建稀疏向量
    const indices = [];
    const values = [];
    let magnitude = 0;
    
    for (const [token, tfValue] of tf) {
      let index = this.vocabulary.get(token);
      if (index === undefined) {
        if (updateIDF) {
          index = this.vocabulary.size;
          this.vocabulary.set(token, index);
        } else {
          continue; // 忽略未见过的词
        }
      }
      
      const idfValue = this.idf.get(token) || 1;
      const tfidf = tfValue * idfValue;
      
      indices.push(index);
      values.push(tfidf);
      magnitude += tfidf * tfidf;
    }
    
    magnitude = Math.sqrt(magnitude);
    
    return { indices, values, magnitude, tokens };
  }

  /**
   * 序列化模型
   * @returns {Object}
   */
  serialize() {
    return {
      vocabulary: Array.from(this.vocabulary.entries()),
      idf: Array.from(this.idf.entries()),
      documentCount: this.documentCount,
      documentFrequency: Array.from(this.documentFrequency.entries())
    };
  }

  /**
   * 从序列化数据加载
   * @param {Object} data - 序列化数据
   */
  deserialize(data) {
    this.vocabulary = new Map(data.vocabulary);
    this.idf = new Map(data.idf);
    this.documentCount = data.documentCount || 0;
    this.documentFrequency = new Map(data.documentFrequency || []);
  }
}

// ==================== VectorStore 类 ====================

/**
 * 向量存储 - 管理向量索引和语义搜索
 */
class VectorStore {
  constructor(baseDir, options = {}) {
    this.baseDir = baseDir;
    this.indexPath = path.join(baseDir, 'vector_index.json');
    this.embedding = new SimpleEmbedding();
    this.vectors = new Map(); // id -> { indices, values, magnitude }
    this.texts = new Map();   // id -> { content, title, type, created }
    this.similarityThreshold = options.similarityThreshold || 0.1;
    
    this.loadIndex();
  }

  /**
   * 加载索引
   */
  loadIndex() {
    if (fs.existsSync(this.indexPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
        
        // 加载嵌入模型
        if (data.embedding) {
          this.embedding.deserialize(data.embedding);
        }
        
        // 加载向量索引
        if (data.vectors) {
          this.vectors = new Map(Object.entries(data.vectors));
        }
        
        // 加载文本映射
        if (data.texts) {
          this.texts = new Map(Object.entries(data.texts));
        }
        
        console.log(`[VectorStore] 已加载索引: ${this.vectors.size} 条向量`);
      } catch (e) {
        console.error('[VectorStore] 加载索引失败:', e.message);
      }
    }
  }

  /**
   * 保存索引
   */
  saveIndex() {
    try {
      // 确保目录存在
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      
      const data = {
        embedding: this.embedding.serialize(),
        vectors: Object.fromEntries(this.vectors),
        texts: Object.fromEntries(this.texts),
        updatedAt: new Date().toISOString()
      };
      
      fs.writeFileSync(this.indexPath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`[VectorStore] 已保存索引: ${this.vectors.size} 条向量`);
    } catch (e) {
      console.error('[VectorStore] 保存索引失败:', e.message);
    }
  }

  /**
   * 添加向量
   * @param {string} id - 记忆 ID
   * @param {string} content - 内容
   * @param {Object} metadata - 元数据
   */
  add(id, content, metadata = {}) {
    // 组合标题和内容以获得更好的语义
    const textToEmbed = metadata.title 
      ? `${metadata.title} ${content} ${(metadata.tags || []).join(' ')}`
      : content;
    
    // 重新计算所有 IDF（因为文档集合发生了变化）
    // 为了简化，我们使用增量更新
    const vector = this.embedding.embed(textToEmbed, true);
    
    this.vectors.set(id, {
      indices: vector.indices,
      values: vector.values,
      magnitude: vector.magnitude
    });
    
    this.texts.set(id, {
      content,
      title: metadata.title || '',
      type: metadata.type || 'auto',
      tags: metadata.tags || [],
      created: metadata.created || Date.now()
    });
    
    // 延迟保存（批量优化）
    this.debounceSave();
  }

  /**
   * 删除向量
   * @param {string} id - 记忆 ID
   */
  remove(id) {
    this.vectors.delete(id);
    this.texts.delete(id);
    this.debounceSave();
  }

  /**
   * 防抖保存
   */
  debounceSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.saveIndex(), 5000);
  }

  /**
   * 计算余弦相似度
   * @param {Object} vecA - 向量 A
   * @param {Object} vecB - 向量 B
   * @returns {number} 相似度 [-1, 1]
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.magnitude === 0 || vecB.magnitude === 0) {
      return 0;
    }
    
    // 使用稀疏向量计算点积
    let dotProduct = 0;
    const mapA = new Map(vecA.indices.map((i, idx) => [i, vecA.values[idx]]));
    
    for (let i = 0; i < vecB.indices.length; i++) {
      const idx = vecB.indices[i];
      const valB = vecB.values[i];
      const valA = mapA.get(idx);
      if (valA !== undefined) {
        dotProduct += valA * valB;
      }
    }
    
    return dotProduct / (vecA.magnitude * vecB.magnitude);
  }

  /**
   * 语义搜索
   * @param {string} query - 查询文本
   * @param {Object} options - 选项
   * @param {number} options.topK - 返回结果数
   * @param {number} options.threshold - 相似度阈值
   * @param {string[]} options.filterTypes - 类型过滤
   * @returns {Array} 搜索结果
   */
  search(query, options = {}) {
    const { 
      topK = 10, 
      threshold = this.similarityThreshold,
      filterTypes = []
    } = options;
    
    if (this.vectors.size === 0) {
      return [];
    }
    
    // 编码查询
    const queryVector = this.embedding.embed(query, false);
    
    // 计算与所有向量的相似度
    const results = [];
    for (const [id, vector] of this.vectors) {
      const metadata = this.texts.get(id);
      if (!metadata) continue;
      
      // 类型过滤
      if (filterTypes.length > 0 && !filterTypes.includes(metadata.type)) {
        continue;
      }
      
      const similarity = this.cosineSimilarity(queryVector, vector);
      
      if (similarity >= threshold) {
        results.push({
          id,
          similarity,
          content: metadata.content,
          title: metadata.title,
          type: metadata.type,
          tags: metadata.tags,
          created: metadata.created
        });
      }
    }
    
    // 按相似度排序
    results.sort((a, b) => b.similarity - a.similarity);
    
    return results.slice(0, topK);
  }

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    return {
      vectorCount: this.vectors.size,
      vocabularySize: this.embedding.vocabulary.size,
      documentCount: this.embedding.documentCount,
      indexPath: this.indexPath
    };
  }

  /**
   * 重建索引（用于批量导入后）
   * @param {Array} memories - 记忆数组
   */
  rebuildIndex(memories) {
    // 清空现有索引
    this.vectors.clear();
    this.texts.clear();
    this.embedding = new SimpleEmbedding();
    
    // 重新添加所有记忆
    for (const memory of memories) {
      const textToEmbed = memory.title 
        ? `${memory.title} ${memory.content} ${(memory.tags || []).join(' ')}`
        : memory.content;
      
      // 先只分词，不构建向量
      const tokens = this.embedding.tokenize(textToEmbed);
      this.embedding.updateIDF(tokens);
    }
    
    // 第二遍：构建向量
    for (const memory of memories) {
      const textToEmbed = memory.title 
        ? `${memory.title} ${memory.content} ${(memory.tags || []).join(' ')}`
        : memory.content;
      
      const vector = this.embedding.embed(textToEmbed, false);
      
      this.vectors.set(memory.id, {
        indices: vector.indices,
        values: vector.values,
        magnitude: vector.magnitude
      });
      
      this.texts.set(memory.id, {
        content: memory.content,
        title: memory.title || '',
        type: memory.type || 'auto',
        tags: memory.tags || [],
        created: memory.created || Date.now()
      });
    }
    
    this.saveIndex();
    
    return this.getStats();
  }
}

// ==================== 导出 ====================

module.exports = {
  SimpleEmbedding,
  VectorStore
};

// 测试代码
if (require.main === module) {
  console.log('Vector Store - Test Mode\n');
  
  // 测试 SimpleEmbedding
  const embedder = new SimpleEmbedding();
  
  const testTexts = [
    '用户偏好技术流风格的简报',
    '每日新闻汇总报告',
    '用户喜欢技术原理和架构设计'
  ];
  
  console.log('=== 分词测试 ===');
  testTexts.forEach(text => {
    console.log(`\n原文: ${text}`);
    const tokens = embedder.tokenize(text);
    console.log(`分词: ${tokens.join(' | ')}`);
  });
  
  console.log('\n\n=== 向量相似度测试 ===');
  
  const vectorStore = new VectorStore('/tmp/test_vector_store');
  
  // 添加测试数据
  vectorStore.add('mem1', '用户偏好技术流风格的简报，要求包含技术原理、架构设计、实现细节。', {
    title: '用户简报风格偏好',
    type: 'user',
    tags: ['偏好', '简报', '风格']
  });
  
  vectorStore.add('mem2', '每日新闻汇总报告，涵盖金融、科技、产业动态。', {
    title: '每日新闻汇总',
    type: 'auto',
    tags: ['新闻', '汇总', '报告']
  });
  
  vectorStore.add('mem3', '用户每天早上8点需要三份简报：金融动态、软科动态、硬科动态。', {
    title: '用户定时任务习惯',
    type: 'user',
    tags: ['简报', '习惯', '定时任务']
  });
  
  vectorStore.add('mem4', '技术文档应包含实现细节、代码示例和架构图。', {
    title: '技术文档规范',
    type: 'auto',
    tags: ['技术', '文档', '规范']
  });
  
  // 测试语义搜索
  const queries = ['简报', '技术风格', '每日报告', '用户偏好'];
  
  queries.forEach(query => {
    console.log(`\n查询: "${query}"`);
    const results = vectorStore.search(query, { topK: 3 });
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.type}] ${r.title} (相似度: ${r.similarity.toFixed(3)})`);
    });
  });
  
  console.log('\n\n=== 统计信息 ===');
  console.log(vectorStore.getStats());
  
  // 清理
  try {
    fs.rmSync('/tmp/test_vector_store', { recursive: true });
  } catch (e) {}
}
