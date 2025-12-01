// 看板：读取与管理右键保存的文本列表
const STORAGE_KEY_SELECTIONS = "savedSelections";

// 等待页面准备好（如果是在百度页面被替换的情况下）
const waitForPageReady = () => {
  return new Promise((resolve) => {
    // 如果页面已经准备好（有标志或者关键元素已经存在），立即执行
    if (window.__boardPageReady || document.getElementById("search") || document.readyState === "complete") {
      resolve();
      return;
    }
    
    // 否则等待最多 2 秒
    const maxWait = 2000;
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (window.__boardPageReady || document.getElementById("search") || document.readyState === "complete") {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > maxWait) {
        clearInterval(checkInterval);
        resolve(); // 超时也继续执行
      }
    }, 50);
  });
};

// 防止重复渲染的标志
let isUpdatingFromUserAction = false;
let updateTimeout = null;

// 当前选中的 TAB
let currentTab = 'all'; // 'all' | 'vocab' | 'review' | 'history'

// 读取存储列表
const readList = async () => {
  const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(
    STORAGE_KEY_SELECTIONS
  );
  return Array.isArray(list) ? list : [];
};

// 写入存储列表
const writeList = async (list) => {
  await chrome.storage.local.set({ [STORAGE_KEY_SELECTIONS]: list });
};

// 格式化时间
const formatTime = (ts) => {
  try {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch (e) {
    return String(ts || "");
  }
};

// 简单 HTML 转义，避免 XSS
const escapeHtml = (s) => {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// 规范化工具
const normalizeWordOld = (w) => (w || "").trim(); // 保留旧函数名，避免影响现有代码
const normalizeSentences = (arr) => {
  // 去重（不区分大小写），保持原有顺序
  const seen = new Set();
  const out = [];
  for (const s of arr || []) {
    const v = (s || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
};

const normalizeSentenceKey = (s) => (s || "").trim().toLowerCase();

// 词性中文映射
const partOfSpeechMap = {
  'noun': '名词',
  'verb': '动词',
  'adjective': '形容词',
  'adverb': '副词',
  'pronoun': '代词',
  'preposition': '介词',
  'conjunction': '连词',
  'interjection': '感叹词',
  'article': '冠词',
  'determiner': '限定词',
  'numeral': '数词',
  'auxiliary': '助动词',
  'modal': '情态动词'
};

const getPartOfSpeechCN = (pos) => {
  const lower = (pos || '').toLowerCase();
  return partOfSpeechMap[lower] || pos;
};

// 判断单词是否可能是复数形式（基于词形规则）
const isLikelyPlural = (word) => {
  const w = word.toLowerCase();
  
  // 明确是复数的模式
  // 1. -ies 结尾 (cities, countries)
  if (w.endsWith('ies') && w.length > 4) {
    return true;
  }
  
  // 2. -es 结尾，且前面是 s, x, z, ch, sh (boxes, classes, dishes)
  if (w.endsWith('es') && w.length > 4) {
    const beforeEs = w.slice(0, -2);
    if (/[sxz]|[cs]h$/.test(beforeEs)) {
      return true;
    }
    // -ves 结尾 (leaves, knives)
    if (w.endsWith('ves') && beforeEs.endsWith('f')) {
      return true;
    }
  }
  
  // 3. 以 -s 结尾，但不是以下情况：
  //    - 以 -ss 结尾 (class, pass)
  //    - 以 -ous 结尾 (previous, various)
  //    - 以 -us 结尾 (focus, status)
  //    - 以 -is 结尾 (basis, crisis)
  //    - 以 -as 结尾 (alias, atlas)
  //    - 以 -es 结尾（已处理）
  if (w.endsWith('s') && !w.endsWith('ss')) {
    // 检查是否是常见的非复数后缀
    const nonPluralSuffixes = ['ous', 'us', 'is', 'as', 'es'];
    const isNonPluralSuffix = nonPluralSuffixes.some(suffix => {
      if (suffix === 'es') {
        // -es 需要特殊处理，因为可能是复数也可能是非复数
        return w.endsWith('es') && !/[sxz]|[cs]h$/.test(w.slice(0, -2));
      }
      return w.endsWith(suffix);
    });
    
    if (isNonPluralSuffix) {
      return false; // 不是复数
    }
    
    // 如果去掉 "s" 后以辅音+元音结尾，更可能是复数
    const withoutS = w.slice(0, -1);
    if (withoutS.length >= 3) {
      // 简单的启发式：如果去掉 s 后以辅音+元音结尾，可能是复数
      // 例如：cat -> cats, dog -> dogs
      const lastTwo = withoutS.slice(-2);
      const hasVowel = /[aeiou]/.test(lastTwo);
      const hasConsonant = /[bcdfghjklmnpqrstvwxyz]/.test(lastTwo);
      if (hasConsonant && hasVowel) {
        return true; // 更可能是复数
      }
    }
    
    // 默认情况下，如果单词长度合理且以 s 结尾，可能是复数
    return w.length >= 4;
  }
  
  return false;
};

// 复数转单数（基于规则的智能判断）
const pluralToSingular = (word) => {
  const w = word.trim().toLowerCase();
  if (w.length <= 2) return w;
  
  // 如果看起来不是复数，直接返回
  if (!isLikelyPlural(w)) {
    return w;
  }
  
  // 常见复数规则
  // -ies -> -y (cities -> city)
  if (w.endsWith('ies') && w.length > 3) {
    return w.slice(0, -3) + 'y';
  }
  
  // -es -> 处理 (boxes -> box, prerequisites -> prerequisite, houses -> house)
  if (w.endsWith('es') && w.length > 3) {
    const withoutEs = w.slice(0, -2);
    const withoutS = w.slice(0, -1);
    
    // 1. 特殊处理：-ves -> -f (leaves -> leaf) 或 -ves -> -fe (knives -> knife)
    // 必须最先检查，因为 "leaves" 去掉 s 后是 "leave"，会误判
    if (w.endsWith('ves') && w.length > 4) {
      const withoutVes = w.slice(0, -3);
      // 如果去掉 ves 后以 f 结尾，直接返回
      if (withoutVes.endsWith('f')) {
        return withoutVes;
      }
      // 尝试两种形式：-f 和 -fe
      const withF = withoutVes + 'f';
      const withFe = withoutVes + 'fe';
      // 启发式判断：检查加 f 后的结尾
      // 如果加 f 后以 "af", "ef", "of", "uf" 等常见结尾，使用 -f（如：leaves -> leaf）
      // 如果加 f 后以 "if" 结尾，通常使用 -fe（如：knives -> knife）
      if (withF.endsWith('if') || withF.endsWith('ef') && !withF.endsWith('leaf') && !withF.endsWith('beef')) {
        // 对于 "knif" 这种情况，使用 -fe
        return withFe;
      }
      // 否则使用 -f（如：leaves -> leaf）
      return withF;
    }
    
    // 2. 如果去掉 "s" 后以 "e" 结尾，且去掉 es 后不以 s/x/z/ch/sh 结尾
    // 或者去掉 es 后虽然以 s 结尾，但去掉 s 后的形式更合理（更长）
    // 例如：prerequisites -> prerequisite, houses -> house
    if (withoutS.endsWith('e') && withoutS.length >= 4) {
      // 如果去掉 es 后以 s 结尾（但不是 ss），且去掉 s 后的形式更长，优先使用去掉 s 的形式
      if ((withoutEs.endsWith('s') && !withoutEs.endsWith('ss')) && withoutS.length > withoutEs.length) {
        return withoutS; // 例如：houses -> house (不是 hous)
      }
      // 如果去掉 es 后不以 s/x/z/ch/sh 结尾，使用去掉 s 的形式
      if (!withoutEs.endsWith('s') && !withoutEs.endsWith('x') && !withoutEs.endsWith('z') && 
          !withoutEs.endsWith('ch') && !withoutEs.endsWith('sh')) {
        return withoutS;
      }
    }
    
    // 3. 如果去掉 es 后以 s, x, z, ch, sh 结尾，直接去掉 es (boxes -> box, classes -> class)
    if (withoutEs.endsWith('s') || withoutEs.endsWith('x') || withoutEs.endsWith('z') || 
        withoutEs.endsWith('ch') || withoutEs.endsWith('sh')) {
      return withoutEs;
    }
    
    // 4. 对于其他情况，先尝试只去掉 "s"（因为很多单词只是单数 + "s"）
    // 如果去掉 "s" 后的形式看起来合理（长度足够，不以奇怪组合结尾）
    if (withoutS.length >= 4) {
      // 避免以 "ou", "u", "i" 结尾（这些通常不是有效的单词结尾）
      if (!withoutS.endsWith('ou') && !withoutS.endsWith('u') && !withoutS.endsWith('i')) {
        return withoutS;
      }
    }
    
    // 5. 如果上述都不匹配，尝试去掉 "es"
    return withoutEs;
  }
  
  // -s -> 去掉 (cats -> cat)
  if (w.endsWith('s') && w.length > 1 && !w.endsWith('ss')) {
    return w.slice(0, -1);
  }
  
  return w;
};

// 规范化单词：统一小写 + 复数转单数
const normalizeWordToSingular = (word) => {
  if (!word) return '';
  const trimmed = word.trim();
  if (!trimmed) return '';
  
  // 先转小写
  const lower = trimmed.toLowerCase();
  
  // 尝试复数转单数
  const singular = pluralToSingular(lower);
  
  return singular;
};

// 生成可能的关联词形式（基于词根）
const generateRelatedWordForms = (root) => {
  if (!root || root.length < 3) return [];
  
  const forms = new Set(); // 使用 Set 去重
  
  // 首先添加词根本身（如果长度合适）
  if (root.length >= 4 && root.length <= 20) {
    forms.add(root);
  }
  
  // 常见的词形变化（按常见程度排序）
  const suffixes = [
    // 动词形式
    'ate',   // verb: hallucinate, accordate (不常见但可能)
    'ing',   // present participle: according, hallucinating
    'ed',    // past tense: accorded, hallucinated
    's',     // third person: accords, hallucinates
    // 名词形式
    'ion',   // noun: accordion (特殊情况)
    'ation', // noun: hallucination, accordation (不常见)
    'ance',  // noun: accordance
    'ancy',  // noun: accordancy (不常见)
    'ence',  // noun: intelligence (intellig + ence)
    'ency',  // noun: emergency (不常见)
    'ment',  // noun: accordment (不常见)
    // 形容词/副词形式
    'ly',    // adverb: accordingly
    'al',    // adjective: accordal (不常见)
    'ic',    // adjective: accordic (不常见)
    'ory',   // adjective: accordory (不常见)
    'atory', // adjective: hallucinatory
    'ative', // adjective: accordative (不常见)
    'ent',   // adjective: intelligent (intellig + ent)
    'ant',   // adjective: important (import + ant)
    'able',  // adjective: accordable
    'ible',  // adjective
    // 其他
    'ism',   // noun: accordism (不常见)
    'ist',   // noun: accordist (不常见)
    'ize',   // verb: accordize (不常见)
    'ise',   // verb (British): accordise (不常见)
    'ify',   // verb: accordify (不常见)
  ];
  
  suffixes.forEach(suffix => {
    const form = root + suffix;
    if (form.length >= 4 && form.length <= 20) {
      forms.add(form);
    }
  });
  
  // 特殊处理：如果词根以特定字母结尾，尝试其他变化
  // 例如：accord -> accord, according, accordance, accorded
  
  return Array.from(forms);
};

// 验证单词是否存在于词典 API
const verifyWordExists = async (word) => {
  try {
    const wordLower = word.trim().toLowerCase();
    if (!wordLower || wordLower.length < 3) return false;
    
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(wordLower)}`);
    return response.ok;
  } catch (e) {
    return false;
  }
};

// 使用 ConceptNet API 获取词族（相关词）
const fetchWordFamilyFromConceptNet = async (word) => {
  try {
    const wordLower = word.toLowerCase();
    // ConceptNet API 免费，无需 API Key
    // 使用多种关系类型获取更全面的词族信息
    const relations = [
      '/r/RelatedTo',      // 相关词
      '/r/FormOf',         // 词形变化
      '/r/DerivedFrom',    // 派生词
      '/r/Synonym'         // 同义词
    ];
    
    const allRelatedWords = new Set();
    
    // 串行请求，避免过多并发导致 502 错误
    // 添加重试机制和错误处理
    for (const rel of relations) {
      try {
        const url = `https://api.conceptnet.io/query?node=/c/en/${encodeURIComponent(wordLower)}&rel=${rel}&limit=10`;
        
        // 添加超时控制（5秒）
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // 如果返回 502 或其他错误，跳过这个关系类型
        if (!response.ok) {
          console.warn(`ConceptNet API 返回错误 ${response.status} for relation ${rel}`);
          continue;
        }
        
        const data = await response.json();
        if (!data || !data.edges || data.edges.length === 0) continue;
        
        data.edges.forEach(edge => {
          // 提取 start 和 end 节点中的单词
          [edge.start, edge.end].forEach(node => {
            if (node && node.label) {
              const label = node.label.toLowerCase();
              // ConceptNet 格式：/c/en/word 或 /c/en/word_phrase
              if (label.startsWith('/c/en/')) {
                const extractedWord = label
                  .replace('/c/en/', '')
                  .replace(/_/g, ' ')
                  .trim();
                
                // 过滤条件：不是当前单词，长度合理，是单个单词（不包含空格）
                if (extractedWord && 
                    extractedWord !== wordLower &&
                    extractedWord.length >= 3 && 
                    extractedWord.length <= 20 &&
                    !extractedWord.includes(' ') &&
                    /^[a-z]+$/.test(extractedWord)) {
                  allRelatedWords.add(extractedWord);
                }
              }
            }
          });
        });
        
        // 添加小延迟，避免请求过快
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        // 单个关系类型失败不影响其他
        if (error.name === 'AbortError') {
          console.warn(`ConceptNet API 请求超时 for relation ${rel}`);
        } else {
          console.warn(`ConceptNet API 请求失败 for relation ${rel}:`, error);
        }
        continue;
      }
    }
    
    return Array.from(allRelatedWords).slice(0, 12); // 最多返回12个
  } catch (error) {
    console.warn('ConceptNet API 请求失败:', error);
    return [];
  }
};

// 从外部 API 查找关联词（使用词根生成方案，ConceptNet 暂时禁用）
const findRelatedWords = async (word, root) => {
  const wordLower = word.toLowerCase();
  
  // 注意：ConceptNet API 目前不稳定（502 错误），暂时禁用
  // 如果将来需要启用，可以取消下面的注释
  /*
  // 1. 优先使用 ConceptNet API 获取词族（快速失败，2秒超时）
  let conceptNetWords = [];
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    conceptNetWords = await Promise.race([
      fetchWordFamilyFromConceptNet(wordLower),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
    ]);
    
    clearTimeout(timeoutId);
    
    if (conceptNetWords && conceptNetWords.length > 0) {
      // 验证这些词是否存在于词典中
      const verifiedWords = [];
      for (const candidate of conceptNetWords.slice(0, 6)) {
        try {
          const exists = await verifyWordExists(candidate);
          if (exists) {
            verifiedWords.push(candidate);
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (e) {
          continue;
        }
      }
      
      if (verifiedWords.length > 0) {
        return verifiedWords.map(word => ({
          word: word,
          id: null,
          source: 'conceptnet'
        }));
      }
    }
  } catch (error) {
    // ConceptNet 失败，快速降级到后备方案
    console.warn('ConceptNet API 不可用，使用词根生成方案');
  }
  */
  
  // 使用词根生成方案（当前主要方案）
  // 基于词根生成词形变化，然后通过 Free Dictionary API 验证
  const rootLower = root ? root.toLowerCase() : '';
  if (!rootLower || rootLower.length < 3) return [];
  
  // 生成可能的关联词形式
  const possibleForms = generateRelatedWordForms(rootLower);
  
  // 过滤掉与当前单词完全相同的（不区分大小写）
  const candidateWords = possibleForms.filter(form => {
    const formLower = form.toLowerCase();
    return formLower !== wordLower;
  });
  
  if (candidateWords.length === 0) return [];
  
  // 限制验证数量，避免过多 API 请求
  const prioritySuffixes = ['', 'ing', 'ed', 's', 'ance', 'ly', 'al', 'ic'];
  const priorityWords = [];
  const otherWords = [];
  
  candidateWords.forEach(candidate => {
    const candidateLower = candidate.toLowerCase();
    const hasPrioritySuffix = prioritySuffixes.some(suffix => {
      if (suffix === '') return candidateLower === rootLower;
      return candidateLower.endsWith(suffix) && candidateLower.length > suffix.length;
    });
    if (hasPrioritySuffix) {
      priorityWords.push(candidate);
    } else {
      otherWords.push(candidate);
    }
  });
  
  // 优先验证常见词形
  priorityWords.sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    if (aLower === rootLower) return -1;
    if (bLower === rootLower) return 1;
    const order = ['ing', 'ed', 's', 'ance', 'ly', 'al', 'ic'];
    const aSuffix = order.findIndex(s => aLower.endsWith(s));
    const bSuffix = order.findIndex(s => bLower.endsWith(s));
    return aSuffix - bSuffix;
  });
  
  const candidatesToVerify = [
    ...priorityWords.slice(0, 8),
    ...otherWords.slice(0, 4)
  ].slice(0, 12);
  
  // 批量验证这些词是否存在
  const validWords = [];
  const verifyPromises = candidatesToVerify.map(async (candidate, index) => {
    await new Promise(resolve => setTimeout(resolve, index * 50));
    try {
      const exists = await verifyWordExists(candidate);
      return exists ? candidate : null;
    } catch (e) {
      return null;
    }
  });
  
  const results = await Promise.allSettled(verifyPromises);
  results.forEach(result => {
    if (result.status === 'fulfilled' && result.value !== null) {
      validWords.push(result.value);
    }
  });
  
  validWords.sort();
  
  return validWords.map(word => ({
    word: word,
    id: null,
    source: 'root-based'
  }));
};

// 获取单词信息（音标、释义、词性）
const fetchWordInfo = async (word) => {
  try {
    const wordLower = word.trim().toLowerCase();
    // 使用 Free Dictionary API (https://dictionaryapi.dev/)
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(wordLower)}`);
    
    if (!response.ok) {
      // 如果 API 失败，返回空信息
      return null;
    }
    
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }
    
    // 取第一个结果（通常是最常用的）
    const entry = data[0];
    
    // 提取音标（优先美式，其次英式）
    let phonetic = '';
    if (entry.phonetic) {
      phonetic = entry.phonetic;
    } else if (entry.phonetics && entry.phonetics.length > 0) {
      // 查找有文本的 phonetics
      const phoneticObj = entry.phonetics.find(p => p.text) || entry.phonetics[0];
      phonetic = phoneticObj?.text || '';
    }
    
    // 提取词性和释义
    const meanings = [];
    if (entry.meanings && Array.isArray(entry.meanings)) {
      entry.meanings.forEach(meaning => {
        if (meaning.partOfSpeech && meaning.definitions && meaning.definitions.length > 0) {
          // 取前 3 个释义
          const definitions = meaning.definitions.slice(0, 3).map(def => def.definition);
          meanings.push({
            partOfSpeech: meaning.partOfSpeech, // 词性：noun, verb, adjective 等
            definitions: definitions
          });
        }
      });
    }
    
    // 提取词根（用于查找关联词）
    const root = extractRootFromWord(wordLower);
    
    return {
      phonetic: phonetic,
      meanings: meanings,
      root: root, // 词根
      source: 'dictionaryapi.dev'
    };
  } catch (error) {
    console.warn('获取单词信息失败:', error);
    return null;
  }
};

// 从单词提取词根（简化版）
const extractRootFromWord = (word) => {
  if (!word) return '';
  let w = word.toLowerCase().trim();
  if (!w) return '';
  
  // 先去掉复数
  w = pluralToSingular(w);
  
  // 递归去掉常见后缀（按优先级排序）
  // 优先级：先去掉副词后缀，再去掉其他后缀
  const suffixGroups = [
    // 第一组：副词后缀（优先处理）
    ['ly'],
    // 第二组：动词/分词后缀
    ['ing', 'ed', 'er', 'est'],
    // 第三组：名词后缀
    ['ation', 'ition', 'ution', 'ance', 'ancy', 'ence', 'ency', 'ment', 'tion', 'sion', 'ism', 'ist'],
    // 第四组：形容词后缀（包括 -ent, -ant）
    ['able', 'ible', 'ous', 'ive', 'ory', 'atory', 'ative', 'ent', 'ant', 'al', 'ic', 'ful', 'less'],
    // 第五组：动词后缀
    ['ize', 'ise', 'ify'],
  ];
  
  let changed = true;
  while (changed && w.length > 3) {
    changed = false;
    for (const group of suffixGroups) {
      for (const suffix of group) {
        if (w.endsWith(suffix) && w.length > suffix.length + 2) {
          w = w.slice(0, -suffix.length);
          changed = true;
          break; // 一次只去掉一个后缀
        }
      }
      if (changed) break; // 如果已经去掉一个后缀，重新开始
    }
  }
  
  return w;
};

// 高亮搜索关键词
const highlightText = (text, query) => {
  if (!query) return escapeHtml(text);
  const regex = new RegExp(`(${escapeHtml(query)})`, 'gi');
  return escapeHtml(text).replace(regex, '<mark class="search-highlight">$1</mark>');
};

// 切换 TAB
const switchTab = async (tab) => {
  currentTab = tab;
  updateTabButtons();
  await chrome.storage.local.set({ selectedTab: tab });
  await updateDisplay();
};

// 更新 TAB 按钮状态
const updateTabButtons = () => {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    if (btn.getAttribute('data-tab') === currentTab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
};

// 今日待复习列表渲染
const renderReview = async () => {
  const panel = document.getElementById('reviewPanel');
  const ul = document.getElementById('reviewList');
  if (!panel || !ul) return;

  if (currentTab === 'all' || currentTab === 'review') {
    panel.style.display = '';
  }

  const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const startTs = todayStart.getTime();
  const endTs = startTs + dayMs;
  const schedule = [1, 3, 7, 15, 30].map((d) => d * dayMs);
  const isReviewedToday = (reviews = []) => reviews.some((t) => t >= startTs && t < endTs);
  const isDueToday = (created) => schedule.some((off) => created + off >= startTs && created + off < endTs);
  let due = list.filter((x) => x.createdAt && isDueToday(x.createdAt));

  // 去重（不区分大小写），保留最早创建
  const wordMap = new Map();
  due.forEach((x) => {
    const wordKey = (x.word || x.text || '').toLowerCase();
    if (!wordMap.has(wordKey)) {
      wordMap.set(wordKey, x);
    } else {
      const existing = wordMap.get(wordKey);
      if (x.createdAt < existing.createdAt) {
        wordMap.set(wordKey, x);
      }
    }
  });
  due = Array.from(wordMap.values());

  if (!due.length) {
      ul.innerHTML = `<li class="review-empty">🎉 太棒了！今日暂无待复习项目</li>`;
    return;
  }

  const isReviewed = (item) => isReviewedToday(item.reviewTimes);

  const header = panel.querySelector('.review-header');
  if (header) {
    const completedCount = due.filter(isReviewed).length;
      header.innerHTML = `📚 今日待复习 (${completedCount}/${due.length})`;
  }

  ul.innerHTML = due
    .map((x) => {
      const checked = isReviewed(x) ? 'checked' : '';
      const statusClass = checked ? 'completed' : 'pending';
      const statusText = checked ? '已完成' : '待复习';

      const reviews = Array.isArray(x.reviewTimes) ? x.reviewTimes.slice().sort((a, b) => a - b) : [];
      const day = 24 * 60 * 60 * 1000;
      const scheduleOffsets = [1, 3, 7, 15, 30].map((d) => d * day);
      let nextDue = null;
      for (const offset of scheduleOffsets) {
        const checkpoint = (x.createdAt || 0) + offset;
        const done = reviews.some((t) => t >= checkpoint);
        if (!done) {
          nextDue = checkpoint;
          break;
        }
      }

      return `<li class="review-item ${checked ? 'completed' : ''}" data-id="${x.id}">
        <div class="review-item-header">
          <span class="word">${escapeHtml(x.word || x.text || '')}</span>
          <div class="review-status ${statusClass}">${statusText}</div>
        </div>
        <div class="review-item-content">
          <div class="review-meta">
            <div class="review-count">${(x.reviewTimes || []).length} 次</div>
            ${nextDue ? `<div class="review-due">${formatTime(nextDue).split(' ')[0]}</div>` : ''}
          </div>
          <input type="checkbox" class="review-done" ${checked}/>
        </div>
      </li>`;
    })
    .join('');
};

// 历史待复习列表渲染
const renderHistoryReview = async () => {
  const panel = document.getElementById('historyReviewPanel');
  const ul = document.getElementById('historyReviewList');
  if (!panel || !ul) return;

  const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const startTs = todayStart.getTime();
  const schedule = [1, 3, 7, 15, 30].map((d) => d * dayMs);
  const isReviewedAtDay = (reviews = [], cp) => {
    const start = new Date(cp);
    start.setHours(0, 0, 0, 0);
    const s = start.getTime();
    const e = s + dayMs;
    return reviews.some((t) => t >= s && t < e);
  };

  const items = [];
  for (const x of list) {
    const created = x.createdAt || 0;
    if (!created) continue;
    const reviews = Array.isArray(x.reviewTimes) ? x.reviewTimes : [];
    for (const off of schedule) {
      const cp = created + off;
      if (cp < startTs && !isReviewedAtDay(reviews, cp)) {
        items.push({ id: x.id, word: x.word || x.text || '', cp, reviewCount: reviews.length });
      }
    }
  }

  const wordMap = new Map();
  items.forEach((item) => {
    const wordKey = item.word.toLowerCase();
    if (!wordMap.has(wordKey)) {
      wordMap.set(wordKey, item);
    } else {
      const existing = wordMap.get(wordKey);
      if (item.cp < existing.cp) {
        wordMap.set(wordKey, item);
      }
    }
  });
  const uniqueItems = Array.from(wordMap.values());

  if (currentTab === 'all' || currentTab === 'history') {
    panel.style.display = uniqueItems.length ? '' : 'none';
  }

  if (!uniqueItems.length) {
      ul.innerHTML = `<li class="review-empty">🎉 太棒了！暂无历史待复习项目</li>`;
    return;
  }

  const header = panel.querySelector('.review-header');
  if (header) {
      header.innerHTML = `📅 历史待复习 (${uniqueItems.length} 项)`;
  }

  ul.innerHTML = uniqueItems
    .sort((a, b) => a.cp - b.cp)
    .map(({ id, word, cp, reviewCount }) => {
      const dateStr = new Date(cp).toISOString().slice(0, 10);
      const daysOverdue = Math.floor((startTs - cp) / dayMs);
      return `<li class="review-item" data-id="${id}" data-cp="${cp}">
        <div class="review-item-header">
          <span class="word">${escapeHtml(word)}</span>
          <div class="review-status pending">逾期 ${daysOverdue} 天</div>
        </div>
        <div class="review-item-content">
          <div class="review-meta">
            <div class="review-count">${reviewCount} 次</div>
            <div class="review-due">应于 ${dateStr}</div>
          </div>
          <input type="checkbox" class="history-review-done"/>
        </div>
      </li>`;
    })
    .join('');
};

// 根据当前 TAB 更新显示
const updateDisplay = async () => {
  const vocabContainer = document.querySelector('.vocab-container');
  const reviewPanel = document.getElementById('reviewPanel');
  const historyReviewPanel = document.getElementById('historyReviewPanel');
  
  // 根据 TAB 显示/隐藏内容
  switch (currentTab) {
    case 'all':
      vocabContainer.style.display = '';
      reviewPanel.style.display = '';
      historyReviewPanel.style.display = '';
      await render();
      await renderReview();
      await renderHistoryReview();
      break;
    case 'vocab':
      vocabContainer.style.display = '';
      reviewPanel.style.display = 'none';
      historyReviewPanel.style.display = 'none';
      await render();
      break;
    case 'review':
      vocabContainer.style.display = 'none';
      reviewPanel.style.display = '';
      historyReviewPanel.style.display = 'none';
      await renderReview();
      break;
    case 'history':
      vocabContainer.style.display = 'none';
      reviewPanel.style.display = 'none';
      historyReviewPanel.style.display = '';
      await renderHistoryReview();
      break;
  }
};

// 渲染表格
const render = async () => {
  const list = await readList();
  const q = (document.getElementById("search").value || "").trim().toLowerCase();
  const sort = (document.getElementById("sortSelect")?.value) || 'time_desc';
  const match = (s) => (s || "").toLowerCase().includes(q);
  let filtered = q
    ? list.filter((x) => match(x.word || x.text))
    : list;

  // 排序
  const getWord = (x) => (x.word || x.text || '').toLowerCase();
  if (sort === 'time_asc') filtered = filtered.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
  else if (sort === 'time_desc') filtered = filtered.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  else if (sort === 'alpha_asc') filtered = filtered.sort((a,b) => getWord(a).localeCompare(getWord(b)));
  else if (sort === 'alpha_desc') filtered = filtered.sort((a,b) => getWord(b).localeCompare(getWord(a)));

  const listContainer = document.getElementById("list");
  const empty = document.getElementById("empty");
  
  if (filtered.length === 0) {
    listContainer.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  
  empty.style.display = "none";
  listContainer.innerHTML = filtered
    .map((item, index) => {
      const url = item.url || "";
      let hostname = "";
      try { hostname = url ? new URL(url).hostname : ""; } catch (e) {}
      const word = item.word || item.text || "";
      const sentences = Array.isArray(item.sentences) ? item.sentences : [];
      const notes = item.notes || {}; // { [sentenceKey]: markdown }
      const reviews = Array.isArray(item.reviewTimes) ? item.reviewTimes.slice().sort((a,b)=>a-b) : [];
      const lastReview = reviews.length ? reviews[reviews.length-1] : 0;
      const day = 24*60*60*1000;
      const schedule = [1,3,7,15,30].map(d=>d*day);
      const created = item.createdAt || 0;
      let nextDue = null;
      for (const offset of schedule) {
        const checkpoint = created + offset;
        const done = reviews.some(t => t >= checkpoint);
        if (!done) { nextDue = checkpoint; break; }
      }
      
      // 单词信息
      const phonetic = item.phonetic || '';
      const meanings = Array.isArray(item.meanings) ? item.meanings : [];
      // 关联词列表（从 API 获取，可能不在本地词库中）
      const relatedWords = Array.isArray(item.relatedWords) ? item.relatedWords : [];
      
      return `
        <div class="vocab-card" data-id="${item.id}" style="animation-delay: ${index * 0.1}s">
          <div class="vocab-card-header">
            <div class="vocab-word-info">
              <div class="vocab-word">${highlightText(word, q)}</div>
              ${phonetic ? `<div class="vocab-phonetic">${escapeHtml(phonetic)}</div>` : ''}
            </div>
            <div class="vocab-actions">
              <button class="icon-btn refresh-word" title="刷新单词信息">↻</button>
              <button class="icon-btn copy" title="复制">⧉</button>
              <button class="icon-btn delete" title="删除">✕</button>
            </div>
          </div>
          
          <div class="vocab-content">
            ${meanings.length > 0 ? `
              <div class="vocab-meanings">
                ${meanings.map(meaning => `
                  <div class="vocab-meaning">
                    <span class="vocab-pos">${escapeHtml(getPartOfSpeechCN(meaning.partOfSpeech))}</span>
                    <ul class="vocab-definitions">
                      ${meaning.definitions.map(def => `<li>${escapeHtml(def)}</li>`).join('')}
                    </ul>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            
            ${relatedWords.length > 0 ? `
              <div class="vocab-related">
                <div class="vocab-related-label">关联词：</div>
                <div class="vocab-related-words">
                  ${relatedWords.map(relatedWord => {
                    // 查找关联词是否在本地词库中
                    const relatedItem = list.find(x => (x.word || x.text || '').toLowerCase() === relatedWord.toLowerCase());
                    const relatedId = relatedItem?.id || '';
                    const isInLocal = !!relatedId;
                    return `<span class="vocab-related-word ${isInLocal ? 'in-local' : 'not-in-local'}" ${relatedId ? `data-related-id="${relatedId}"` : ''} data-word="${escapeHtml(relatedWord)}">${escapeHtml(relatedWord)}</span>`;
                  }).join('')}
                </div>
              </div>
            ` : ''}
            <!-- 例句区域 -->
            <div class="vocab-sentences">
              ${sentences
                .map((s, idx) => `
                  <div class="sentence-item" data-idx="${idx}" data-key="${escapeHtml(normalizeSentenceKey(s))}">
                    <div class="sentence-text${notes[normalizeSentenceKey(s)] ? ' has-note' : ''}">${escapeHtml(s)}</div>
                    <div class="sentence-actions">
                      <button class="icon-btn sentence-delete" title="删除">✕</button>
                    </div>
                  </div>
                `)
                .join("")}
              <div class="add-sentence">
                <input class="input" placeholder="为该单词新增例句，回车保存" />
              </div>
            </div>
            
            <!-- 来源信息 -->
            ${(item.title || url) ? `
              <div class="vocab-source">
                ${item.title ? `<div class="source-title">${escapeHtml(item.title)}</div>` : ""}
                ${url ? `<a href="${escapeHtml(url)}" target="_blank" class="source-url">${escapeHtml(hostname || url)}</a>` : ""}
              </div>
            ` : ""}
            
            <!-- 元数据 -->
            <div class="vocab-meta">
              <div class="meta-row">
                <span class="meta-label">添加时间</span>
                <span class="meta-value">${formatTime(item.createdAt)}</span>
              </div>
              
              <!-- 复习数据 -->
              <div class="review-stats">
                <div class="review-stat">
                  <span>${reviews.length} 次</span>
                </div>
                ${lastReview ? `
                  <div class="review-stat last-review">
                    <span>${formatTime(lastReview).split(' ')[0]}</span>
                  </div>
                ` : ""}
                ${nextDue ? `
                  <div class="review-stat next-due">
                    <span>${formatTime(nextDue).split(' ')[0]}</span>
                  </div>
                ` : ""}
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
};

// 等待页面准备好后再执行
waitForPageReady().then(() => {
  // 如果 DOMContentLoaded 已经触发，直接执行初始化
  if (document.readyState === "complete" || document.readyState === "interactive") {
    initializeBoard();
  } else {
    // 否则等待 DOMContentLoaded
    document.addEventListener("DOMContentLoaded", initializeBoard, { once: true });
    // 如果已经加载完成，立即触发
    if (document.readyState !== "loading") {
      const event = new Event("DOMContentLoaded", { bubbles: true });
      document.dispatchEvent(event);
    }
  }
});

const initializeBoard = async () => {
  // 应用主题并监听切换
  const applyTheme = (value) => {
    const cls = `theme-${value}`;
    document.documentElement.classList.remove("theme-cyan", "theme-purple", "theme-pink", "theme-green", "theme-slate");
    document.documentElement.classList.add(cls);
  };
  {
    const { themePreset } = await chrome.storage.local.get("themePreset");
    applyTheme(themePreset || "cyan");
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.themePreset) {
      applyTheme(changes.themePreset.newValue || "cyan");
    }
  });

  // 初始化 TAB 切换
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
  });
  
  // 读取保存的 TAB 选择
  const { selectedTab } = await chrome.storage.local.get('selectedTab');
  if (selectedTab) {
    currentTab = selectedTab;
    updateTabButtons();
  }
  
  await updateDisplay();
  const searchEl = document.getElementById("search");
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      if (currentTab === 'all' || currentTab === 'vocab') {
        render();
      }
    });
    // 点击原生 clear 按钮（type=search 的 ×）会触发 search 事件
    searchEl.addEventListener("search", () => {
      if (currentTab === 'all' || currentTab === 'vocab') {
        render();
      }
    });
    searchEl.addEventListener("change", () => {
      if (currentTab === 'all' || currentTab === 'vocab') {
        render();
      }
    });
    searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (currentTab === 'all' || currentTab === 'vocab')) {
        render();
      }
    });
  }

  const sortEl = document.getElementById('sortSelect');
  if (sortEl) {
    // 读取上次选择
    const { vocabSort } = await chrome.storage.local.get('vocabSort');
    if (vocabSort) {
      sortEl.value = vocabSort;
      // 应用持久化排序到首次渲染（已在 updateDisplay 中处理）
    }
    sortEl.addEventListener('change', async () => {
      await chrome.storage.local.set({ vocabSort: sortEl.value });
      await updateDisplay();
    });
  }

  document.getElementById("export").addEventListener("click", async () => {
    const list = await readList();
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocabulary_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Modal helpers
  const show = (el) => (el.style.display = "flex");
  const hide = (el) => (el.style.display = "none");

  // 清空全部（Modal）
  const modalClear = document.getElementById("modalClear");
  const clearInput = document.getElementById("clearInput");
  document.getElementById("clearAll").addEventListener("click", () => {
    clearInput.value = "";
    show(modalClear);
    clearInput.focus();
  });
  // 关闭（X 与蒙层）
  document.getElementById("clearClose").addEventListener("click", () => hide(modalClear));
  document.getElementById("modalClear").addEventListener("click", (e) => { if (e.target.id === 'modalClear') hide(modalClear); });
  document.getElementById("clearConfirm").addEventListener("click", async () => {
    if (clearInput.value !== "清空") return;
    await writeList([]);
    await updateDisplay();
    hide(modalClear);
  });

  // 移除添加弹窗逻辑（采用行内回车新增句子）
  // 新增单词（Modal）
  const modalAddWord = document.getElementById("modalAddWord");
  const addWordInput = document.getElementById("addWordInput");
  document.getElementById("addWordBtn").addEventListener("click", () => {
    addWordInput.value = "";
    show(modalAddWord);
    addWordInput.focus();
  });

  // 空状态添加单词按钮
  document.getElementById("addFirstWord").addEventListener("click", () => {
    addWordInput.value = "";
    show(modalAddWord);
    addWordInput.focus();
  });
  document.getElementById("addWordClose").addEventListener("click", () => hide(modalAddWord));
  document.getElementById("modalAddWord").addEventListener("click", (e) => { if (e.target.id === 'modalAddWord') hide(modalAddWord); });
  document.getElementById("addWordConfirm").addEventListener("click", async () => {
    const inputWord = (addWordInput.value || "").trim();
    if (!inputWord) return;
    
    // 规范化单词：统一小写 + 复数转单数
    const normalizedWord = normalizeWordToSingular(inputWord);
    
    const list = await readList();
    const exists = list.some(x => {
      const existingWord = (x.word || x.text || "").toLowerCase();
      return existingWord === normalizedWord;
    });
    if (exists) { 
      alert(`单词 "${normalizedWord}" 已存在`); 
      return; 
    }
    
    // 显示加载状态
    const confirmBtn = document.getElementById("addWordConfirm");
    const originalText = confirmBtn.textContent;
    confirmBtn.textContent = "获取中...";
    confirmBtn.disabled = true;
    
    // 自动获取单词信息
    const wordInfo = await fetchWordInfo(normalizedWord);
    
    // 查找关联词
    const root = wordInfo?.root || extractRootFromWord(normalizedWord);
    const relatedWords = await findRelatedWords(normalizedWord, root);
    
    const now = Date.now();
    const item = { 
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`, 
      word: normalizedWord, // 存储规范化后的单词
      originalWord: inputWord !== normalizedWord ? inputWord : undefined, // 保存原始输入（如果不同）
      sentences: [], 
      reviewTimes: [], 
      url: "", 
      title: "", 
      createdAt: now,
      // 添加单词信息
      phonetic: wordInfo?.phonetic || '',
      meanings: wordInfo?.meanings || [],
      root: root, // 词根
      relatedWords: relatedWords.map(r => r.word) // 关联词列表
    };
    
    await writeList([item, ...list]);
    await updateDisplay();
    hide(modalAddWord);
    
    // 恢复按钮状态
    confirmBtn.textContent = originalText;
    confirmBtn.disabled = false;
  });

  document.getElementById("list").addEventListener("click", async (e) => {
    // 处理关联词点击
    const relatedWordEl = e.target.closest(".vocab-related-word");
    if (relatedWordEl) {
      const relatedId = relatedWordEl.getAttribute("data-related-id");
      const relatedWord = relatedWordEl.getAttribute("data-word");
      
      if (relatedId) {
        // 如果在本地词库中，滚动到对应的单词卡片
        const targetCard = document.querySelector(`.vocab-card[data-id="${relatedId}"]`);
        if (targetCard) {
          targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // 高亮显示
          targetCard.style.transition = 'all 0.3s ease';
          targetCard.style.boxShadow = '0 0 0 4px rgba(0, 229, 255, 0.4)';
          setTimeout(() => {
            targetCard.style.boxShadow = '';
          }, 2000);
        }
      } else if (relatedWord) {
        // 如果不在本地词库中，提示用户是否添加
        if (confirm(`单词 "${relatedWord}" 不在词库中，是否添加到词库？`)) {
          const list = await readList();
          const exists = list.some(x => (x.word || x.text || '').toLowerCase() === relatedWord.toLowerCase());
          if (exists) {
            alert("单词已存在");
            return;
          }
          
          // 添加单词
          const now = Date.now();
          const normalizedWord = normalizeWordToSingular(relatedWord);
          
          // 获取单词信息
          const wordInfo = await fetchWordInfo(normalizedWord);
          const root = wordInfo?.root || extractRootFromWord(normalizedWord);
          const relatedWords = await findRelatedWords(normalizedWord, root);
          
          const newItem = {
            id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
            word: normalizedWord,
            originalWord: relatedWord !== normalizedWord ? relatedWord : undefined,
            sentences: [],
            reviewTimes: [],
            url: "",
            title: "",
            createdAt: now,
            phonetic: wordInfo?.phonetic || '',
            meanings: wordInfo?.meanings || [],
            root: root,
            relatedWords: relatedWords.map(r => r.word)
          };
          
          await writeList([newItem, ...list]);
          await updateDisplay();
        }
      }
      return;
    }
    
    const btn = e.target.closest("button");
    if (!btn) return;
    const card = e.target.closest(".vocab-card[data-id]");
    if (!card) return;
    const id = card.getAttribute("data-id");
    let list = await readList();
    const item = list.find((x) => x.id === id);
    if (!item) return;

    // 删除单条造句
    if (btn.classList.contains("sentence-delete")) {
      const sentenceItem = btn.closest(".sentence-item");
      const idx = Number(sentenceItem?.getAttribute("data-idx"));
      if (!Number.isFinite(idx)) return;
      item.sentences = normalizeSentences((item.sentences || []).filter((_, i) => i !== idx));
      
      // 设置标志，防止存储监听器触发重新渲染
      isUpdatingFromUserAction = true;
      await writeList(list);
      
      // 只更新当前卡片，避免重新渲染整个列表
      await updateVocabCard(item);
      
      // 延迟重置标志
      setTimeout(() => {
        isUpdatingFromUserAction = false;
      }, 100);
      return;
    }

    // 在该条目下新增造句（使用同一行的 input）
    if (btn.classList.contains("sentence-add")) {
      const input = btn.closest(".sentence-item")?.querySelector("input");
      const val = (input?.value || "").trim();
      if (!val) return;
      item.sentences = normalizeSentences([val, ...(item.sentences || [])]).slice(0, 20);
      await writeList(list);
      // 只更新当前卡片，避免重新渲染整个列表
      await updateVocabCard(item);
      if (currentTab === 'all' || currentTab === 'review') {
        await renderReview();
      }
      return;
    }

    if (btn.classList.contains("refresh-word")) {
      const originalWord = item.word || item.text || "";
      if (!originalWord) return;
      
      // 显示加载状态
      const prevText = btn.textContent;
      btn.textContent = "⏳";
      btn.disabled = true;
      
      try {
        // 应用规范化规则：统一小写 + 复数转单数
        const normalizedWord = normalizeWordToSingular(originalWord);
        // 检查是否需要规范化：原始单词与规范化后的单词不同（包括大小写、复数等）
        const needsNormalization = originalWord !== normalizedWord;
        
        // 如果单词需要规范化，更新单词字段
        if (needsNormalization) {
          // 保存原始输入（如果还没有保存）
          if (!item.originalWord) {
            item.originalWord = originalWord;
          }
          item.word = normalizedWord;
        }
        
        // 获取单词信息（使用规范化后的单词）
        const wordInfo = await fetchWordInfo(normalizedWord);
        if (wordInfo) {
          item.phonetic = wordInfo.phonetic;
          item.meanings = wordInfo.meanings;
          item.root = wordInfo.root;
          
          // 更新关联词（使用规范化后的单词和词根）
          const root = wordInfo.root || extractRootFromWord(normalizedWord);
          const relatedWords = await findRelatedWords(normalizedWord, root);
          item.relatedWords = relatedWords.map(r => r.word);
          
          await writeList(list);
          await render();
          btn.textContent = "✓";
          setTimeout(() => {
            btn.textContent = prevText;
            btn.disabled = false;
          }, 1000);
        } else {
          alert("未找到该单词的信息");
          btn.textContent = prevText;
          btn.disabled = false;
        }
      } catch (e) {
        console.error("刷新单词信息失败:", e);
        alert("获取单词信息失败，请稍后重试");
        btn.textContent = prevText;
        btn.disabled = false;
      }
      return;
    }

    if (btn.classList.contains("copy")) {
      try {
        const textToCopy = [item.word || item.text || "", ...(item.sentences || [])].filter(Boolean).join("\n");
        await navigator.clipboard.writeText(textToCopy);
        const prevText = btn.textContent;
        const prevTitle = btn.title;
        btn.textContent = "✓";
        btn.title = "已复制";
        btn.classList.add("copied");
        btn.disabled = true;
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove("copied");
          btn.textContent = "⧉";
          btn.title = prevTitle || "复制";
        }, 1000);
      } catch (e) {
        alert("复制失败");
      }
      return;
    }

    if (btn.classList.contains("delete")) {
      if (!confirm("确认删除该条目？")) return;
      
      // 添加删除动画
      card.style.transition = 'all 0.3s ease';
      card.style.transform = 'translateX(-100%)';
      card.style.opacity = '0';
      
      // 延迟执行删除
      setTimeout(async () => {
        list = list.filter((x) => x.id !== id);
        
        // 设置标志，防止存储监听器触发重新渲染
        isUpdatingFromUserAction = true;
        await writeList(list);
        
        // 移除DOM元素
        card.remove();
        
        // 延迟重置标志
        setTimeout(() => {
          isUpdatingFromUserAction = false;
        }, 100);
      }, 300);
      return;
    }
  });

  // 更新单个词汇卡片
  const updateVocabCard = async (item) => {
    const card = document.querySelector(`.vocab-card[data-id="${item.id}"]`);
    if (!card) return;
    
    const sentences = Array.isArray(item.sentences) ? item.sentences : [];
    const notes = item.notes || {};
    const reviews = Array.isArray(item.reviewTimes) ? item.reviewTimes.slice().sort((a,b)=>a-b) : [];
    const lastReview = reviews.length ? reviews[reviews.length-1] : 0;
    const day = 24*60*60*1000;
    const schedule = [1,3,7,15,30].map(d=>d*day);
    const created = item.createdAt || 0;
    let nextDue = null;
    for (const offset of schedule) {
      const checkpoint = created + offset;
      const done = reviews.some(t => t >= checkpoint);
      if (!done) { nextDue = checkpoint; break; }
    }
    
    const url = item.url || "";
    let hostname = "";
    try { hostname = url ? new URL(url).hostname : ""; } catch (e) {}
    const word = item.word || item.text || "";
    const q = (document.getElementById("search").value || "").trim().toLowerCase();
    
    // 只更新例句区域
    const sentencesContainer = card.querySelector('.vocab-sentences');
    if (sentencesContainer) {
      const newContent = `
        ${sentences
          .map((s, idx) => `
            <div class="sentence-item" data-idx="${idx}" data-key="${escapeHtml(normalizeSentenceKey(s))}" style="animation: slideIn 0.3s ease-out; animation-delay: ${idx * 0.1}s">
              <div class="sentence-text${notes[normalizeSentenceKey(s)] ? ' has-note' : ''}">${escapeHtml(s)}</div>
              <div class="sentence-actions">
                <button class="icon-btn sentence-delete" title="删除">✕</button>
              </div>
            </div>
          `)
          .join("")}
        <div class="add-sentence">
          <input class="input" placeholder="为该单词新增例句，回车保存" />
        </div>
      `;
      
      sentencesContainer.innerHTML = newContent;
    }
    
    // 更新复习数据
    const reviewStats = card.querySelector('.review-stats');
    if (reviewStats) {
      reviewStats.innerHTML = `
        <div class="review-stat">
          <span>${reviews.length} 次</span>
        </div>
        ${lastReview ? `
          <div class="review-stat last-review">
            <span>${formatTime(lastReview).split(' ')[0]}</span>
          </div>
        ` : ""}
        ${nextDue ? `
          <div class="review-stat next-due">
            <span>${formatTime(nextDue).split(' ')[0]}</span>
          </div>
        ` : ""}
      `;
    }
  };

  // 句子输入框回车保存（事件委托）
  document.getElementById("list").addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const input = e.target.closest(".add-sentence input");
    if (!input) return;
    e.preventDefault();
    const card = input.closest(".vocab-card[data-id]");
    if (!card) return;
    const id = card.getAttribute("data-id");
    let list = await readList();
    const item = list.find((x) => x.id === id);
    if (!item) return;
    const val = (input.value || "").trim();
    if (!val) return;
    const prev = item.sentences || [];
    const nextSentences = normalizeSentences([val, ...prev]).slice(0, 20);
    // 若句子集变动，需迁移 notes 的 key
    if (item.notes) {
      const newNotes = {};
      for (const s of nextSentences) {
        const k = normalizeSentenceKey(s);
        if (item.notes[k]) newNotes[k] = item.notes[k];
      }
      item.notes = newNotes;
    }
    item.sentences = nextSentences;
    input.value = ""; // 清空输入框
    
    // 设置标志，防止存储监听器触发重新渲染
    isUpdatingFromUserAction = true;
    await writeList(list);
    
    // 只更新当前卡片，避免重新渲染整个列表
    await updateVocabCard(item);
    
    // 延迟重置标志
    setTimeout(() => {
      isUpdatingFromUserAction = false;
    }, 100);
  });

  // 右键句子：新增/编辑解析（Markdown）和点击查看
  const modalNote = document.getElementById("modalNote");
  const noteEditor = document.getElementById("noteEditor");
  const notePreview = document.getElementById("notePreview");
  const btnView = document.getElementById("noteView");
  const btnEdit = document.getElementById("noteEdit");
  const btnSave = document.getElementById("noteSave");
  const btnDelete = document.getElementById("noteDelete");
  const renderMarkdown = (md) => {
    // 极简 Markdown 渲染（标题/粗斜体/代码/引用/链接/列表/分割线/表格）
    let src = (md || "");
    // 先转义 HTML
    src = src.replace(/[&<>]/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));

    // 表格解析（简单实现）：以 \n| 开头的块视为表格，按 | 切分
    src = src.replace(/(?:^|\n)(\|[^\n]+\|)(?:\n\|[\-\s:]+\|)?((?:\n\|[^\n]+\|)+)/g, (m, header, rows) => {
      const toCells = (line) => line.trim().slice(1, -1).split('|').map(s => s.trim());
      const ths = toCells(header).map((h) => `<th>${h}</th>`).join('');
      const trs = rows.trim().split('\n').map(r => `<tr>${toCells(r).map((c)=>`<td>${c}</td>`).join('')}</tr>`).join('');
      return `\n<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    });

    // 代码块（```）
    src = src.replace(/```([\s\S]*?)```/g, (m, code) => `<pre><code>${code.replace(/</g,'&lt;')}</code></pre>`);

    // 标题
    src = src
      .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
      .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
      .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // 分割线 --- 或 ***
    src = src.replace(/^\s*(?:---|\*\*\*)\s*$/gm, '<hr/>');

    // 引用、列表（简化）
    src = src
      .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^\s*[-*]\s+(.+)$/gm, '<ul><li>$1</li></ul>');

    // 行内样式与链接
    src = src
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[(.+?)\]\((https?:[^\s)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // 段落
    src = src.replace(/\n\n+/g, '</p><p>');
    return `<p>${src}</p>`;
  };

  let currentNoteTarget = null; // { id, idx }

  const setMode = (mode) => { // 'edit' | 'view'
    if (mode === 'view') {
      notePreview.style.display = '';
      noteEditor.style.display = 'none';
      btnView.style.display = 'none';
      btnEdit.style.display = '';
      btnSave.style.display = 'none';
      btnDelete.style.display = '';
    } else {
      notePreview.style.display = 'none';
      noteEditor.style.display = '';
      btnView.style.display = '';
      btnEdit.style.display = 'none';
      btnSave.style.display = '';
      btnDelete.style.display = 'none';
    }
  };

  const openNoteModal = (markdown, prefer = 'edit') => {
    noteEditor.value = markdown || '';
    if (prefer === 'view' && markdown) {
      notePreview.innerHTML = renderMarkdown(markdown);
      setMode('view');
    } else {
      setMode('edit');
    }
    show(modalNote);
    if (prefer !== 'view') noteEditor.focus();
  };
  const closeNoteModal = () => { hide(modalNote); currentNoteTarget = null; };

  document.getElementById("noteClose").addEventListener("click", closeNoteModal);
  document.getElementById("modalNote").addEventListener("click", (e) => { if (e.target.id === 'modalNote') closeNoteModal(); });
  btnView.addEventListener("click", () => {
    notePreview.innerHTML = renderMarkdown(noteEditor.value || '');
    setMode('view');
  });
  btnEdit.addEventListener("click", () => {
    setMode('edit');
    noteEditor.focus();
  });
  document.getElementById("noteSave").addEventListener("click", async () => {
    if (!currentNoteTarget) { closeNoteModal(); return; }
    const { id, idx, key } = currentNoteTarget;
    let list = await readList();
    const item = list.find((x) => x.id === id);
    if (!item) { closeNoteModal(); return; }
    const md = (noteEditor.value || '').trim();
    item.notes = item.notes || {};
    const sentenceKey = key || normalizeSentenceKey((item.sentences||[])[idx]||'');
    if (md) item.notes[sentenceKey] = md; else delete item.notes[sentenceKey];
    await writeList(list);
    if (currentTab === 'all' || currentTab === 'vocab') {
      await render();
    }
    closeNoteModal();
  });

  // 右键打开解析编辑；左键查看（若有解析）
  document.getElementById("list").addEventListener("contextmenu", async (e) => {
    const el = e.target.closest('.sentence-text');
    if (!el) return;
    e.preventDefault();
    const card = el.closest('.vocab-card[data-id]');
    const sentenceItem = el.closest('.sentence-item');
    if (!card || !sentenceItem) return;
    const id = card.getAttribute('data-id');
    const idx = Number(sentenceItem.getAttribute('data-idx'));
    const key = sentenceItem.getAttribute('data-key');
    let list = await readList();
    const item = list.find((x) => x.id === id);
    const md = (item?.notes && item.notes[key || normalizeSentenceKey((item.sentences||[])[idx]||'')]) || '';
    currentNoteTarget = { id, idx, key };
    // 如果已有解析，右键进入预览态；否则进入编辑态
    openNoteModal(md, md ? 'view' : 'edit');
  });

  document.getElementById("list").addEventListener("click", async (e) => {
    const el = e.target.closest('.sentence-text');
    if (!el || !el.classList.contains('has-note')) return;
    const card = el.closest('.vocab-card[data-id]');
    const sentenceItem = el.closest('.sentence-item');
    if (!card || !sentenceItem) return;
    const id = card.getAttribute('data-id');
    const idx = Number(sentenceItem.getAttribute('data-idx'));
    const key = sentenceItem.getAttribute('data-key');
    let list = await readList();
    const item = list.find((x) => x.id === id);
    const md = (item?.notes && item.notes[key || normalizeSentenceKey((item.sentences||[])[idx]||'')]) || '';
    currentNoteTarget = { id, idx, key };
    // 左键点击：已有解析则预览，否则进入编辑
    openNoteModal(md, md ? 'view' : 'edit');
  });

  // 删除解析
  btnDelete.addEventListener('click', async () => {
    if (!currentNoteTarget) { closeNoteModal(); return; }
    const { id, idx, key } = currentNoteTarget;
    let list = await readList();
    const item = list.find((x) => x.id === id);
    if (!item) { closeNoteModal(); return; }
    const k = key || normalizeSentenceKey((item.sentences||[])[idx]||'');
    if (item.notes && item.notes[k]) {
      delete item.notes[k];
      await writeList(list);
      if (currentTab === 'all' || currentTab === 'vocab') {
        await render();
      }
    }
    closeNoteModal();
  });

  // 监听存储变化（其它页面新增/删除时刷新）
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && changes[STORAGE_KEY_SELECTIONS]) {
      const newList = changes[STORAGE_KEY_SELECTIONS].newValue || [];
      const oldList = changes[STORAGE_KEY_SELECTIONS].oldValue || [];
      
      // 检测新添加的单词，进行规范化处理
      if (newList.length > oldList.length) {
        const newItems = newList.filter(newItem => {
          const exists = oldList.some(oldItem => oldItem.id === newItem.id);
          return !exists && (newItem.word || newItem.text);
        });
        
        // 异步处理新单词（不阻塞 UI）
        for (const item of newItems) {
          const word = item.word || item.text;
          if (!word) continue;
          
          // 规范化单词：统一小写 + 复数转单数
          const normalizedWord = normalizeWordToSingular(word);
          const needsNormalization = word.toLowerCase() !== normalizedWord;
          
          // 延迟处理，避免频繁请求
          setTimeout(async () => {
            const list = await readList();
            const targetItem = list.find(x => x.id === item.id);
            if (!targetItem) return;
            
            let updated = false;
            
            // 如果需要规范化，更新单词
            if (needsNormalization && targetItem.word === word) {
              targetItem.originalWord = word; // 保存原始输入
              targetItem.word = normalizedWord;
              updated = true;
            }
            
            // 如果还没有音标或释义，获取单词信息
            if (!targetItem.phonetic && (!targetItem.meanings || targetItem.meanings.length === 0)) {
              const wordInfo = await fetchWordInfo(normalizedWord);
              if (wordInfo) {
                targetItem.phonetic = wordInfo.phonetic;
                targetItem.meanings = wordInfo.meanings;
                targetItem.root = wordInfo.root;
                updated = true;
              }
            }
            
            // 如果还没有关联词，查找关联词
            if (!targetItem.relatedWords || targetItem.relatedWords.length === 0) {
              const root = targetItem.root || extractRootFromWord(normalizedWord);
              const relatedWords = await findRelatedWords(normalizedWord, root);
              if (relatedWords.length > 0) {
                targetItem.relatedWords = relatedWords.map(r => r.word);
                updated = true;
              }
            }
            
            if (updated) {
              await writeList(list);
              // 如果当前正在显示这个单词，更新显示
              if (currentTab === 'all' || currentTab === 'vocab') {
                await render();
              }
            }
          }, 500);
        }
      }
      
      // 如果是从用户操作触发的更新，跳过重新渲染
      if (isUpdatingFromUserAction) {
        isUpdatingFromUserAction = false;
        return;
      }
      
      // 清除之前的延迟更新
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
      
      // 根据当前 TAB 更新显示
      if (currentTab === 'all' || currentTab === 'vocab') {
        render();
      }
      // 完全禁用待复习列表的自动重新渲染，避免抖动
      // 待复习列表只在页面加载时和手动操作时更新
    }
  });

  // 更新单个复习卡片的UI
  const updateReviewCardUI = (li, item, checked) => {
    // 使用 requestAnimationFrame 确保在下一帧更新，避免布局抖动
    requestAnimationFrame(() => {
      const statusEl = li.querySelector('.review-status');
      const reviewCountEl = li.querySelector('.review-count');
      
      if (statusEl) {
        statusEl.className = `review-status ${checked ? 'completed' : 'pending'}`;
        statusEl.textContent = checked ? '已完成' : '待复习';
      }
      
      if (reviewCountEl) {
        const reviewCount = Array.isArray(item.reviewTimes) ? item.reviewTimes.length : 0;
        reviewCountEl.textContent = `${reviewCount} 次`;
      }
    });
  };

  // 更新复习面板标题
  const updateReviewPanelHeader = async () => {
    const panel = document.getElementById('reviewPanel');
    const header = panel?.querySelector('.review-header');
    if (!header) return;
    
    const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
    const dayMs = 24*60*60*1000;
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const startTs = todayStart.getTime();
    const endTs = startTs + dayMs;
    const schedule = [1,3,7,15,30].map(d=>d*dayMs);
    const isReviewedToday = (reviews=[]) => reviews.some(t => t >= startTs && t < endTs);
    const isDueToday = (created) => schedule.some(off => (created + off) >= startTs && (created + off) < endTs);
    const due = list.filter(x => x.createdAt && isDueToday(x.createdAt));
    const completedCount = due.filter(x => isReviewedToday(x.reviewTimes)).length;
    const totalCount = due.length;
    
    // 使用 requestAnimationFrame 确保在下一帧更新，避免布局抖动
    requestAnimationFrame(() => {
      header.innerHTML = `📚 今日待复习 (${completedCount}/${totalCount})`;
    });
  };

  const reviewListEl = document.getElementById('reviewList');
  const handleTodayToggle = async (li, checked) => {
    const id = li.getAttribute('data-id');
    const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
    const item = list.find(x => x.id === id);
    if (!item) return;
    item.reviewTimes = Array.isArray(item.reviewTimes) ? item.reviewTimes : [];
    const dayMs = 24*60*60*1000;
    const todayStart = new Date(); todayStart.setHours(12,0,0,0); // 中午时间，避免夏令时边界
    const startTs = todayStart.getTime() - 12*60*60*1000; // 当天0点
    const endTs = startTs + dayMs;
    
    // 添加视觉反馈
    if (checked) {
      li.classList.add('completed');
      if (!item.reviewTimes.some(t => t >= startTs && t < endTs)) item.reviewTimes.push(todayStart.getTime());
    } else {
      li.classList.remove('completed');
      item.reviewTimes = item.reviewTimes.filter(t => !(t >= startTs && t < endTs));
    }
    
    // 设置标志，防止存储监听器触发重新渲染
    isUpdatingFromUserAction = true;
    
    // 先更新UI，再写入存储，确保用户体验流畅
    updateReviewCardUI(li, item, checked);
    updateReviewPanelHeader();
    
    // 延迟写入存储，避免与UI更新冲突
    setTimeout(async () => {
      await writeList(list);
      isUpdatingFromUserAction = false;
    }, 50);
  };
  if (reviewListEl) {
    reviewListEl.addEventListener('click', async (e) => {
      const cb = e.target.closest('.review-done');
      if (!cb) return;
      const li = cb.closest('.review-item');
      await handleTodayToggle(li, cb.checked);
    });
    reviewListEl.addEventListener('change', async (e) => {
      const cb = e.target.closest('.review-done');
      if (!cb) return;
      const li = cb.closest('.review-item');
      await handleTodayToggle(li, cb.checked);
    });
  }

  // 更新历史待复习面板标题
  const updateHistoryReviewPanelHeader = async () => {
    const panel = document.getElementById('historyReviewPanel');
    const header = panel?.querySelector('.review-header');
    if (!header) return;
    
    const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
    const dayMs = 24*60*60*1000;
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const startTs = todayStart.getTime();
    const schedule = [1,3,7,15,30].map(d=>d*dayMs);
    const isReviewedAtDay = (reviews=[], cp) => {
      const start = new Date(cp); start.setHours(0,0,0,0);
      const s = start.getTime();
      const e = s + dayMs;
      return reviews.some(t => t >= s && t < e);
    };
    const items = [];
    for (const x of list) {
      const created = x.createdAt || 0;
      if (!created) continue;
      const reviews = Array.isArray(x.reviewTimes) ? x.reviewTimes : [];
      for (const off of schedule) {
        const cp = created + off;
        if (cp < startTs && !isReviewedAtDay(reviews, cp)) {
          items.push({ id: x.id, word: x.word || x.text || '', cp, reviewCount: reviews.length });
        }
      }
    }
    
    header.innerHTML = `📅 历史待复习 (${items.length} 项)`;
  };

  const historyListEl = document.getElementById('historyReviewList');
  historyListEl && historyListEl.addEventListener('change', async (e) => {
    const target = e.target;
    if (!(target && target.classList && target.classList.contains('history-review-done'))) return;
    const li = target.closest('.review-item');
    if (!li) return;
    const id = li.getAttribute('data-id');
    const cp = Number(li.getAttribute('data-cp'));
    const { [STORAGE_KEY_SELECTIONS]: list = [] } = await chrome.storage.local.get(STORAGE_KEY_SELECTIONS);
    const item = list.find(x => x.id === id);
    if (!item) return;
    item.reviewTimes = Array.isArray(item.reviewTimes) ? item.reviewTimes : [];
    // 将打卡时间设为节点当天（避免跨天误差）
    const dayStart = new Date(cp); dayStart.setHours(12,0,0,0);
    item.reviewTimes.push(dayStart.getTime());
    
    // 设置标志，防止存储监听器触发重新渲染
    isUpdatingFromUserAction = true;
    
    // 先更新UI，再写入存储，确保用户体验流畅
    li.classList.add('completed');
    const statusEl = li.querySelector('.review-status');
    const reviewCountEl = li.querySelector('.review-count');
    
    if (statusEl) {
      statusEl.className = 'review-status completed';
      statusEl.textContent = '已完成';
    }
    
    if (reviewCountEl) {
      const reviewCount = Array.isArray(item.reviewTimes) ? item.reviewTimes.length : 0;
      reviewCountEl.textContent = `${reviewCount} 次`;
    }
    
    // 延迟写入存储，避免与UI更新冲突
    setTimeout(async () => {
      await writeList(list);
      isUpdatingFromUserAction = false;
    }, 50);
    
    // 延迟移除卡片，给用户视觉反馈
    setTimeout(() => {
      li.style.transition = 'all 0.3s ease';
      li.style.transform = 'translateX(-100%)';
      li.style.opacity = '0';
      setTimeout(() => {
        li.remove();
        updateHistoryReviewPanelHeader();
      }, 300);
    }, 500);
  });

};


