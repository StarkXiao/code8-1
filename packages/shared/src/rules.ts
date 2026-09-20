import type { VagueCategory } from './enums';

/**
 * 模糊描述规范化规则库（项目文档第 12 章）。
 *
 * 这里只做"建议"，最终值必须由整理者确认落笔 —— 规则引擎永远不下结论。
 */

export interface NormalizationRule {
  id: string;
  category: VagueCategory;
  /** 命中词/短语 */
  patterns: string[];
  /** 原话示例 */
  example: string;
  /** 建议解读 */
  suggestion: string;
  /** 建议追问 */
  question: string;
  /** 默认置信度（规则只能给暂定/推算，不能直接给已确认） */
  defaultConfidence: 'estimated' | 'assumed';
}

export const NORMALIZATION_RULES: NormalizationRule[] = [
  // ---------------- 用量 ----------------
  {
    id: 'amount.tiny',
    category: 'amount',
    patterns: ['一点点', '一点', '少许', '一丢丢', '叮点'],
    example: '放一点点糖',
    suggestion: '主料的 0.5%–1%，或 1–3g',
    question: '这个地方您说"{原话}"，大概几克？或者用您平时那只勺，是几勺？',
    defaultConfidence: 'assumed',
  },
  {
    id: 'amount.moderate',
    category: 'amount',
    patterns: ['适量', '差不多', '看着放', '凭感觉', '随口味'],
    example: '盐适量就行',
    suggestion: '给出区间，例如 2–4g，并注明"按口味调整"',
    question: '您平时放盐大概放到什么程度？有没有一个大概的量或者参照？',
    defaultConfidence: 'assumed',
  },
  {
    id: 'amount.handful',
    category: 'amount',
    patterns: ['一小把', '一把', '一撮'],
    example: '抓一小把虾皮',
    suggestion: '约 10–15g（视食材密度），"一撮"约 1–2g',
    question: '抓起来大概多大一把？能和鸡蛋比一下吗？',
    defaultConfidence: 'estimated',
  },
  {
    id: 'amount.spoon',
    category: 'amount',
    patterns: ['半勺', '一勺', '两勺', '一平勺', '一汤匙', '一茶匙'],
    example: '加半勺老抽',
    suggestion: '先登记"家里那只勺 = X g"，再换算；平勺/满勺需区分',
    question: '您常用的那只勺，一平勺大概几克？',
    defaultConfidence: 'estimated',
  },
  // ---------------- 火候 ----------------
  {
    id: 'heat.level',
    category: 'heat',
    patterns: ['大火', '中火', '小火', '文火', '猛火', '中小火', '中大火'],
    example: '中火炒',
    suggestion: '对应家用灶档位 + 温度带 + 火苗范围描述',
    question: '"{原话}"的时候，火苗大概到锅底哪一圈？锅里的油是什么状态？',
    defaultConfidence: 'estimated',
  },
  {
    id: 'heat.sizzle',
    category: 'heat',
    patterns: ['噼里啪啦', '滋啦', '有声音', '爆香', '冒烟', '别糊了'],
    example: '听到噼里啪啦就差不多了',
    suggestion: '把声音/烟雾转成观察指标：气泡密度、烟量、颜色',
    question: '听到噼里啪啦的时候，锅里是什么样子的？大概持续多久？',
    defaultConfidence: 'assumed',
  },
  {
    id: 'heat.reduce',
    category: 'heat',
    patterns: ['收汁', '大火收汁', '汤汁浓稠', '挂勺'],
    example: '最后大火收汁',
    suggestion: '液面下降约 1/2，勺子划过能挂住一层汁',
    question: '到什么样子算收好了？是大火还是中火？大概几分钟？',
    defaultConfidence: 'assumed',
  },
  // ---------------- 手感 ----------------
  {
    id: 'feel.dough',
    category: 'feel',
    patterns: ['不粘手', '能拉丝', '有筋道', '揉出膜', '光滑'],
    example: '揉到不粘手就行',
    suggestion: '面团表面不粘手、按压缓慢回弹、拉开有薄膜',
    question: '"{原话}"是摸起来什么感觉？能和什么东西比一下吗？大概揉多久？',
    defaultConfidence: 'assumed',
  },
  {
    id: 'feel.texture',
    category: 'feel',
    patterns: ['像耳垂', '软硬适中', '弹牙', '入口即化', '发起来'],
    example: '面团软得像耳垂一样',
    suggestion: '用常见物做对照（耳垂/橡皮泥/棉花）',
    question: '和什么东西的手感最像？按下去会不会马上弹回来？',
    defaultConfidence: 'assumed',
  },
  // ---------------- 时间 ----------------
  {
    id: 'time.vague',
    category: 'time',
    patterns: ['一会儿', '等一下', '片刻', '稍等', '很快'],
    example: '焖一会儿',
    suggestion: '转成 3–8 分钟区间，并注明是否盖盖、火候',
    question: '大概几分钟？中间要不要盖盖？火大还是火小？',
    defaultConfidence: 'assumed',
  },
  {
    id: 'time.until',
    category: 'time',
    patterns: ['炖到烂', '炖烂', '焖到软', '差不多就行', '多焖一会', '看情况'],
    example: '炖到用筷子能戳透',
    suggestion: '给出结束判据 + 时长区间，例如 40–60 分钟，筷子能轻松插透',
    question: '炖到烂的时候怎么判断？用筷子试的时候是什么感觉？大概要多久？',
    defaultConfidence: 'assumed',
  },
  // ---------------- 其他 ----------------
  {
    id: 'other.legacy',
    category: 'other',
    patterns: ['老式的做法', '按老规矩', '你懂的', '就是这样'],
    example: '按老规矩来',
    suggestion: '需要把"老规矩"整体追问成一组明确步骤',
    question: '能把这个"老规矩"从头说一遍吗？哪一步最容易出错？',
    defaultConfidence: 'assumed',
  },
];

export interface NormalizationMatch {
  ruleId: string;
  category: VagueCategory;
  matchedPattern: string;
  suggestion: string;
  question: string;
  defaultConfidence: 'estimated' | 'assumed';
}

/** 在一段文本中查找所有命中的模糊描述规则 */
export function matchVaguePhrases(text: string): NormalizationMatch[] {
  const source = text ?? '';
  const matches: NormalizationMatch[] = [];
  const seen = new Set<string>();

  for (const rule of NORMALIZATION_RULES) {
    for (const pattern of rule.patterns) {
      if (!source.includes(pattern)) continue;
      const key = `${rule.id}:${pattern}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        ruleId: rule.id,
        category: rule.category,
        matchedPattern: pattern,
        suggestion: rule.suggestion,
        question: rule.question,
        defaultConfidence: rule.defaultConfidence,
      });
      break; // 同一规则只报一次
    }
  }

  return matches;
}

/** 用原话填充追问模板 */
export function renderQuestionTemplate(template: string, rawPhrase: string): string {
  return template.replace(/\{原话\}/g, rawPhrase);
}

/** 没有命中规则时的兜底追问 */
export function fallbackQuestion(rawPhrase: string): string {
  return `这一步"${rawPhrase}"我有点拿不准，能再说详细一点吗？（可以直接按住说话）`;
}
