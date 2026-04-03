/**
 * Memory Extractor - 后台记忆提取模块
 * 
 * 自动从对话中提取关键信息并保存为 auto 类型记忆
 * 支持配置敏感度、避免重复提取
 */

const { MemoryManager } = require('./memoryManager');
const path = require('path');

// ==================== 提取规则定义 ====================

/**
 * 提取规则类型
 * @typedef {Object} ExtractionRule
 * @property {string} name - 规则名称
 * @property {string} category - 类别 (preference, decision, project, todo)
 * @property {string[]} patterns - 正则表达式模式（字符串形式）
 * @property {string[]} keywords - 关键词列表
 * @property {number} priority - 优先级 (1-10)
 * @property {Function} [extractor] - 自定义提取函数
 */

const DEFAULT_RULES = [
  // ===== 用户偏好 =====
  {
    name: 'preference_like',
    category: 'preference',
    patterns: [
      /我(?:喜欢|爱|钟爱|偏好|倾向于)\s*[：:]?\s*(.+?)(?:[。，；]|\n|$)/i,
      /我(?:习惯|通常|一般)\s*(.+?)(?:[。，；]|\n|$)/i,
      /我(?:觉得|认为)\s*(.+?)\s*(?:比较|更|挺)(?:好|棒|不错|合适)/i,
      /我(?:不喜欢|讨厌|反感)\s*(.+?)(?:[。，；]|\n|$)/i,
    ],
    keywords: ['我喜欢', '我偏好', '我习惯', '我不喜欢', '我讨厌'],
    priority: 9,
    description: '用户偏好提取'
  },
  {
    name: 'preference_style',
    category: 'preference',
    patterns: [
      /(?:风格|样式|样式|外观)\s*(?:上|方面)?\s*[：:]?\s*我(?:喜欢|想要|偏好|倾向于)\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:颜色|配色|主题)\s*(?:上|方面)?\s*[：:]?\s*(?:我)?(?:喜欢|想要|偏好)\s*(.+?)(?:[。，；]|\n|$)/i,
    ],
    keywords: ['风格', '样式', '配色', '颜色', '主题'],
    priority: 8,
    description: '用户风格偏好'
  },
  
  // ===== 重要决策 =====
  {
    name: 'decision_made',
    category: 'decision',
    patterns: [
      /(?:我|我们)(?:决定|选定|确定|拍板|敲定)\s*[：:]?\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:决定|选定|确定|拍板)\s*(?:了|采用|使用)\s*[：:]?\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:最终|最后|结果)\s*(?:选择|决定|确定|采用)\s*[：:]?\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:选|用|采用)\s*(.+?)\s*(?:吧|了|作为)/i,
    ],
    keywords: ['决定', '选定', '确定', '拍板', '敲定', '最终选择', '最后决定'],
    priority: 10,
    description: '重要决策'
  },
  {
    name: 'decision_rejected',
    category: 'decision',
    patterns: [
      /(?:不|放弃|拒绝|排除)\s*(?:使用|采用|选择|考虑)\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:否决|放弃|pass|不选)\s*(?:了|掉)?\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:不用|不选|不采用|不考虑)\s*(.+?)(?:[。，；]|\n|$)/i,
    ],
    keywords: ['不采用', '放弃', '否决', 'pass掉', '不选', '排除'],
    priority: 8,
    description: '决策排除项'
  },
  
  // ===== 项目信息 =====
  {
    name: 'project_name',
    category: 'project',
    patterns: [
      /(?:项目|工程|产品)\s*(?:名|叫|名称)\s*(?:为|是)?\s*[：:]?\s*["']?([^"'，。\n]{2,30})["']?/i,
      /(?:做|开发|搞|启动)\s*(?:一个|个)?\s*(?:叫|名为)?\s*["']?([^"'，。\n]{2,30})["']?\s*(?:的)?\s*(?:项目|系统|产品|应用)/i,
      /["']([^"']{2,30})["']\s*(?:项目|系统|产品|应用)/i,
    ],
    keywords: ['项目', '工程', '产品', '系统', '应用'],
    priority: 9,
    description: '项目名称'
  },
  {
    name: 'project_stack',
    category: 'project',
    patterns: [
      /(?:技术栈|使用|采用|基于)\s*[：:]?\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:用|采用|选)\s*(Node\.js|Python|Java|Go|Rust|React|Vue|Angular|MySQL|PostgreSQL|MongoDB|Redis|Docker|Kubernetes)\s*(?:开发|实现|搭建|部署|做)/i,
      /(?:前端|后端|数据库|框架)\s*(?:用|采用|选)\s*[：:]?\s*(.+?)(?:[。，；]|\n|$)/i,
    ],
    keywords: ['技术栈', '前端', '后端', '数据库', '框架', 'Node.js', 'Python', 'React', 'Vue'],
    priority: 8,
    description: '技术栈信息'
  },
  {
    name: 'project_deadline',
    category: 'project',
    patterns: [
      /(?:截止|交付|上线|完成|DDL|deadline)\s*(?:日期|时间)?\s*[：:]?\s*(\d{4}[年/-]\d{1,2}[月/-]\d{1,2}[日]?)/i,
      /(?:在|于)?\s*(\d{4}[年/-]\d{1,2}[月/-]\d{1,2}[日]?)\s*(?:之前|前|以前)?\s*(?:完成|交付|上线|截止)/i,
      /(?:本周五|下周一|本月底|下个月|这周五|下周五|这周|下周)\s*(?:完成|交付|上线)/i,
    ],
    keywords: ['截止', 'DDL', 'deadline', '交付日期', '上线时间', '完成时间'],
    priority: 9,
    description: '项目截止日期'
  },
  {
    name: 'project_goal',
    category: 'project',
    patterns: [
      /(?:目标|目的是|旨在|为了)\s*[：:]?\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:想要|希望|需要)\s*(?:实现|达到|完成)\s*[：:]?\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:做这个项目|开发这个|搞这个)\s*(?:是为了|目的是|想要)\s*(.+?)(?:[。，；]|\n|$)/i,
    ],
    keywords: ['目标', '目的', '旨在', '为了', '实现'],
    priority: 7,
    description: '项目目标'
  },
  
  // ===== 待办事项 =====
  {
    name: 'todo_explicit',
    category: 'todo',
    patterns: [
      /(?:TODO|FIXME|HACK|BUG)[\s:：]+(.+?)(?:\n|$)/i,
      /(?:待办|待处理|待完成|待确认)[\s:：]+(.+?)(?:[。，；]|\n|$)/i,
      /(?:记得|别忘了|记住)\s*(?:要|去)?\s*(.+?)(?:[。，；]|\n|$)/i,
    ],
    keywords: ['TODO', 'FIXME', '待办', '待处理', '记得', '别忘了'],
    priority: 10,
    description: '明确待办'
  },
  {
    name: 'todo_need_action',
    category: 'todo',
    patterns: [
      /(?:需要|应该|得|要)\s*(?:做|处理|完成|确认|检查|测试|修复|优化)\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:还|仍)\s*(?:没|未)\s*(?:完成|做完|处理|确认|搞定)/i,
      /(?:后面|稍后|改天|有空|之后)\s*(?:再|需要|得)\s*(做|处理|完成|确认)\s*(.+?)(?:[。，；]|\n|$)/i,
    ],
    keywords: ['需要做', '应该做', '得做', '要做', '还没完成', '稍后处理'],
    priority: 8,
    description: '待执行动作'
  },
  {
    name: 'todo_plan',
    category: 'todo',
    patterns: [
      /(?:计划|打算|准备|安排)\s*(?:要|去)?\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:下一步|接下来|然后|之后)\s*(?:要|需要|得)?\s*(做|处理|完成|确认)\s*(.+?)(?:[。，；]|\n|$)/i,
      /(?:明天|后天|下周|这周|周末|晚上|明天早上)\s*(?:要|得|准备|计划)\s*(.+?)(?:[。，；]|\n|$)/i,
    ],
    keywords: ['计划', '打算', '准备', '下一步', '接下来', '明天要'],
    priority: 7,
    description: '计划事项'
  },
];

// ==================== 敏感度配置 ====================

const SENSITIVITY_CONFIG = {
  high: {
    // 高敏感度：捕获更多潜在信息，但可能有误报
    minPriority: 5,
    minMatchConfidence: 0.4,
    keywordMatch: true,
    patternMatch: true,
    checkSimilarity: true,
    similarityThreshold: 0.6
  },
  medium: {
    // 中敏感度：平衡准确率和召回率
    minPriority: 7,
    minMatchConfidence: 0.6,
    keywordMatch: true,
    patternMatch: true,
    checkSimilarity: true,
    similarityThreshold: 0.75
  },
  low: {
    // 低敏感度：只提取高置信度信息，准确率优先
    minPriority: 8,
    minMatchConfidence: 0.8,
    keywordMatch: true,
    patternMatch: true,
    checkSimilarity: true,
    similarityThreshold: 0.85
  }
};

// ==================== 记忆提取器类 ====================

class MemoryExtractor {
  constructor(options = {}) {
    this.manager = new MemoryManager(options.baseDir);
    this.rules = options.rules || DEFAULT_RULES;
    this.sensitivity = options.sensitivity || 'medium';
    this.config = SENSITIVITY_CONFIG[this.sensitivity];
    this.extractionHistory = new Set(); // 防止同一会话重复提取
  }

  /**
   * 设置敏感度
   * @param {'high'|'medium'|'low'} level 
   */
  setSensitivity(level) {
    if (!SENSITIVITY_CONFIG[level]) {
      throw new Error(`Invalid sensitivity level: ${level}. Use 'high', 'medium', or 'low'.`);
    }
    this.sensitivity = level;
    this.config = SENSITIVITY_CONFIG[level];
  }

  /**
   * 添加自定义规则
   * @param {ExtractionRule} rule 
   */
  addRule(rule) {
    this.rules.push(rule);
    // 按优先级排序
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 从对话中提取记忆
   * @param {string} conversation - 对话内容
   * @param {Object} context - 上下文信息
   * @returns {Array} 提取的记忆列表
   */
  extract(conversation, context = {}) {
    const extractions = [];
    const lines = conversation.split(/\n+/);
    
    // 检查每行文本
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.length < 5) continue; // 忽略太短的行
      
      // 检查每个规则
      for (const rule of this.rules) {
        // 优先级过滤
        if (rule.priority < this.config.minPriority) continue;
        
        // 关键词预过滤
        if (this.config.keywordMatch && rule.keywords) {
          const hasKeyword = rule.keywords.some(kw => 
            trimmedLine.toLowerCase().includes(kw.toLowerCase())
          );
          if (!hasKeyword) continue;
        }
        
        // 正则匹配
        if (this.config.patternMatch && rule.patterns) {
          for (const pattern of rule.patterns) {
            const match = trimmedLine.match(pattern);
            if (match) {
              const extraction = this._processMatch(match, rule, trimmedLine, context);
              if (extraction && this._validateExtraction(extraction)) {
                extractions.push(extraction);
              }
              break; // 每个规则只提取一次
            }
          }
        }
      }
    }
    
    // 去重
    return this._deduplicateExtractions(extractions);
  }

  /**
   * 处理匹配结果
   * @private
   */
  _processMatch(match, rule, originalText, context) {
    const content = match[1] || match[0];
    if (!content || content.length < 3) return null;
    
    // 清理内容
    const cleanedContent = content
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (cleanedContent.length < 3) return null;
    
    return {
      category: rule.category,
      rule: rule.name,
      content: cleanedContent,
      originalText: originalText.trim(),
      priority: rule.priority,
      context: context,
      timestamp: Date.now()
    };
  }

  /**
   * 验证提取结果
   * @private
   */
  _validateExtraction(extraction) {
    // 内容长度检查
    if (extraction.content.length < 5) return false;
    if (extraction.content.length > 500) return false; // 太长的可能是误报
    
    // 过滤掉常见噪音
    const noisePatterns = [
      /^这个$/i, /^那个$/i, /^然后$/i, /^所以$/i,
      /^(?:是|的|了|吗|呢|吧)$/,
      /^\d+$/ // 纯数字
    ];
    
    if (noisePatterns.some(p => p.test(extraction.content))) {
      return false;
    }
    
    return true;
  }

  /**
   * 去重处理
   * @private
   */
  _deduplicateExtractions(extractions) {
    const seen = new Set();
    const unique = [];
    
    for (const extraction of extractions) {
      const key = `${extraction.category}:${extraction.content.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(extraction);
      }
    }
    
    return unique;
  }

  /**
   * 计算文本相似度（简化版余弦相似度）
   * @private
   */
  _calculateSimilarity(text1, text2) {
    const words1 = this._tokenize(text1);
    const words2 = this._tokenize(text2);
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * 文本分词（简化版）
   * @private
   */
  _tokenize(text) {
    // 简单的中文分词：按字和常见词分割
    return text
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0);
  }

  /**
   * 检查是否已存在相似记忆
   * @param {Object} extraction 
   * @returns {boolean}
   */
  hasSimilarMemory(extraction) {
    if (!this.config.checkSimilarity) return false;
    
    const existingMemories = this.manager.loadAll();
    const categoryMemories = existingMemories.filter(m => {
      // 检查标签匹配
      return m.tags && m.tags.includes(extraction.category);
    });
    
    for (const memory of categoryMemories) {
      const similarity = this._calculateSimilarity(
        extraction.content,
        memory.content
      );
      
      if (similarity >= this.config.similarityThreshold) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * 提取并保存记忆
   * @param {string} conversation 
   * @param {Object} context 
   * @returns {Object} 提取和保存结果
   */
  extractAndSave(conversation, context = {}) {
    const extractions = this.extract(conversation, context);
    const saved = [];
    const skipped = [];
    
    for (const extraction of extractions) {
      // 检查重复
      if (this.hasSimilarMemory(extraction)) {
        skipped.push({ ...extraction, reason: 'similar_exists' });
        continue;
      }
      
      // 检查历史（同一会话内）
      const historyKey = `${extraction.category}:${extraction.content}`;
      if (this.extractionHistory.has(historyKey)) {
        skipped.push({ ...extraction, reason: 'already_extracted' });
        continue;
      }
      
      this.extractionHistory.add(historyKey);
      
      // 创建记忆
      const memory = this.manager.create({
        type: 'auto',
        content: extraction.content,
        title: this._generateTitle(extraction),
        tags: [extraction.category, extraction.rule, 'auto_extracted'],
        source: context.source || 'background_extraction'
      });
      
      saved.push({
        extraction,
        memoryId: memory.id
      });
    }
    
    return {
      total: extractions.length,
      saved: saved.length,
      skipped: skipped.length,
      memories: saved,
      skippedDetails: skipped
    };
  }

  /**
   * 生成记忆标题
   * @private
   */
  _generateTitle(extraction) {
    const categoryTitles = {
      preference: '用户偏好',
      decision: '重要决策',
      project: '项目信息',
      todo: '待办事项'
    };
    
    const category = categoryTitles[extraction.category] || '提取记忆';
    const preview = extraction.content.slice(0, 30);
    const suffix = extraction.content.length > 30 ? '...' : '';
    
    return `${category}: ${preview}${suffix}`;
  }

  /**
   * 获取提取统计
   */
  getStats() {
    const memories = this.manager.loadAll();
    const autoMemories = memories.filter(m => m.type === 'auto');
    
    const byCategory = {};
    for (const mem of autoMemories) {
      const category = mem.tags?.find(t => 
        ['preference', 'decision', 'project', 'todo'].includes(t)
      ) || 'other';
      byCategory[category] = (byCategory[category] || 0) + 1;
    }
    
    return {
      totalAutoMemories: autoMemories.length,
      byCategory,
      sensitivity: this.sensitivity,
      rulesCount: this.rules.length
    };
  }
}

// ==================== 后台提取服务 ====================

class BackgroundExtractor {
  constructor(options = {}) {
    this.extractor = new MemoryExtractor(options);
    this.interval = options.interval || 60000; // 默认60秒检查一次
    this.buffer = []; // 对话缓冲区
    this.isRunning = false;
    this.timer = null;
  }

  /**
   * 添加对话到缓冲区
   * @param {string} text 
   * @param {Object} context 
   */
  addConversation(text, context = {}) {
    this.buffer.push({
      text,
      context,
      timestamp: Date.now()
    });
  }

  /**
   * 启动后台提取
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.timer = setInterval(() => {
      this._processBuffer();
    }, this.interval);
    
    console.log(`[BackgroundExtractor] Started with ${this.interval}ms interval`);
  }

  /**
   * 停止后台提取
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    
    // 处理剩余缓冲区
    this._processBuffer();
    
    console.log('[BackgroundExtractor] Stopped');
  }

  /**
   * 立即处理缓冲区
   * @private
   */
  _processBuffer() {
    if (this.buffer.length === 0) return;
    
    // 合并缓冲区内容
    const combinedText = this.buffer.map(b => b.text).join('\n');
    const combinedContext = this.buffer[this.buffer.length - 1].context;
    
    // 执行提取
    const result = this.extractor.extractAndSave(combinedText, combinedContext);
    
    if (result.saved > 0) {
      console.log(`[BackgroundExtractor] Extracted ${result.saved} memories`);
    }
    
    // 清空缓冲区
    this.buffer = [];
  }

  /**
   * 立即触发提取
   */
  flush() {
    this._processBuffer();
  }
}

// ==================== 导出 ====================

module.exports = {
  MemoryExtractor,
  BackgroundExtractor,
  DEFAULT_RULES,
  SENSITIVITY_CONFIG
};