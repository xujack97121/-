const RELEVANCE_VERSION = 2;
const USER_ID = /^[a-f\d]{24}$/i;
const MAX_NOTES = 8;

// Expand recognized fields only. A specific, unknown phrase must retain its own meaning.
const FIELDS = [
  { aliases: ["家居", "家装", "居家"], terms: ["家居", "家装", "软装", "室内设计", "室内装修", "装修", "家具", "家电", "全屋定制", "收纳", "客厅改造", "卧室改造", "卧室布置", "客厅布置", "租房改造", "厨房改造", "住宅设计", "小户型装修"] },
  { aliases: ["软装", "软装设计", "家居软装"], terms: ["软装", "家居搭配", "家具搭配", "窗帘搭配", "灯光设计", "空间配色", "客厅布置", "卧室布置"] },
  { aliases: ["收纳", "家居收纳", "整理收纳", "收纳整理"], terms: ["收纳", "整理师", "整理规划", "衣橱整理", "衣柜整理", "断舍离", "储物规划"] },
  { aliases: ["装修", "室内设计", "装修设计", "室内装修"], terms: ["装修", "室内设计", "家装", "住宅设计", "全屋定制", "水电改造", "户型改造", "厨房改造", "客厅改造"] },
  { aliases: ["美妆", "化妆", "彩妆"], terms: ["美妆", "化妆", "彩妆", "妆容", "底妆", "眼妆", "口红", "粉底", "腮红", "修容"] },
  { aliases: ["护肤", "皮肤护理"], terms: ["护肤", "皮肤护理", "防晒", "精华测评", "面霜", "洁面", "保湿", "修护屏障"] },
  { aliases: ["穿搭", "服装", "时尚穿搭"], terms: ["穿搭", "服装搭配", "时尚", "ootd", "通勤搭配", "显高搭配", "显瘦搭配", "男装", "女装"] },
  { aliases: ["美食", "餐饮", "烹饪"], terms: ["美食", "餐饮", "烹饪", "菜谱", "食谱", "家常菜", "烘焙", "甜品", "火锅", "做饭", "小吃", "餐厅", "咖啡制作", "咖啡探店"] },
  { aliases: ["母婴", "育儿", "亲子"], terms: ["母婴", "育儿", "亲子", "宝宝辅食", "婴儿", "新生儿", "带娃", "早教", "孕产", "哺乳"] },
  { aliases: ["运动", "健身", "体育"], terms: ["运动", "健身", "体育", "力量训练", "有氧训练", "普拉提", "瑜伽", "跑步", "游泳", "增肌", "减脂训练"] },
  { aliases: ["旅游", "旅行", "文旅"], terms: ["旅游", "旅行", "文旅", "旅拍", "景点攻略", "旅行攻略", "自驾游", "自由行", "酒店测评", "民宿", "徒步路线"] },
  { aliases: ["数码", "科技", "数码科技"], terms: ["数码", "科技", "手机测评", "相机测评", "电脑", "笔记本测评", "智能硬件", "耳机测评", "电子产品"] },
  { aliases: ["人工智能", "ai", "aigc"], terms: ["人工智能", "ai", "aigc", "大模型", "机器学习", "深度学习", "提示词", "智能体"] },
  { aliases: ["汽车", "车评", "汽车行业"], terms: ["汽车", "车评", "新能源车", "电动车测评", "车型测评", "试驾", "购车", "用车", "车辆保养"] },
  { aliases: ["宠物", "萌宠"], terms: ["宠物", "萌宠", "养猫", "养狗", "猫粮", "狗粮", "猫咪", "狗狗", "宠物护理"] },
  { aliases: ["教育", "学习", "教学"], terms: ["教育", "学习", "教学", "课程", "教研", "备考", "考试", "老师", "英语", "数学", "语文"] },
  { aliases: ["摄影", "拍照", "摄影摄像"], terms: ["摄影", "拍照", "人像摄影", "风光摄影", "摄影构图", "摄影布光", "修图", "调色教程", "摄像", "镜头测评"] },
  { aliases: ["职场", "求职", "职业发展"], terms: ["职场", "求职", "职业发展", "简历", "面试", "招聘", "职业规划", "工作汇报", "办公效率"] },
  { aliases: ["创业", "商业", "企业经营"], terms: ["创业", "商业", "企业经营", "公司运营", "商业模式", "开店", "品牌经营", "市场营销"] },
  { aliases: ["电商", "电子商务"], terms: ["电商", "电子商务", "店铺运营", "选品", "直播带货", "跨境电商", "独立站", "淘宝运营"] },
  { aliases: ["金融", "财经", "投资理财"], terms: ["金融", "财经", "投资理财", "股票", "基金", "证券", "资产配置", "宏观经济", "财务规划"] },
  { aliases: ["房产", "房地产", "买房"], terms: ["房产", "房地产", "买房", "楼盘", "购房", "二手房", "新房交易", "卖房", "房价"] },
  { aliases: ["绘画", "画画", "美术"], terms: ["绘画", "画画", "美术", "插画", "素描", "水彩", "油画", "国画", "板绘"] },
  { aliases: ["音乐", "乐器"], terms: ["音乐", "乐器", "吉他", "钢琴", "声乐", "作曲", "编曲", "唱歌", "乐理"] },
  { aliases: ["读书", "阅读", "文学"], terms: ["读书", "阅读", "文学", "书评", "书单", "小说", "诗歌", "作家", "散文"] },
  { aliases: ["园艺", "种植", "绿植"], terms: ["园艺", "种植", "绿植", "养花", "花卉", "盆栽", "扦插", "多肉", "植物养护"] },
];

const clean = (value, maximum = 1200) => typeof value === "string"
  ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, " ").trim().slice(0, maximum) : "";
const fold = (value) => clean(value).toLowerCase();
const unique = (values) => [...new Set(values)];
const tagsOf = (value) => unique((Array.isArray(value) ? value : []).slice(0, 20)
  .map((tag) => clean(tag, 80).replace(/^#+|#+$/g, "").trim()).filter(Boolean));
const withoutHashtags = (value) => clean(value).replace(/#[^\s#]+#?/gu, " ");

function keywordGroups(keyword, aliasesOnly = false) {
  const query = clean(keyword, 80).replace(/^#+|#+$/g, "")
    .replace(/(?:行业|领域|类目|类博主|博主|达人|相关)+$/u, "").trim();
  if (!query) return [];
  const exact = FIELDS.find((field) => field.aliases.some((alias) => fold(alias) === fold(query)));
  if (exact) return [aliasesOnly ? exact.aliases : exact.terms];
  const parts = query.split(/[\s,，、;；/|+]+/u).map((part) => part.replace(/^#+|#+$/g, "")).filter(Boolean).slice(0, 8);
  return parts.map((part) => {
    const field = FIELDS.find((entry) => entry.aliases.some((alias) => fold(alias) === fold(part)));
    return field ? (aliasesOnly ? field.aliases : field.terms) : [part];
  });
}

function occurrences(text, term) {
  const result = [];
  let from = 0;
  while (from < text.length) {
    const index = text.indexOf(term, from);
    if (index < 0) break;
    const before = text[index - 1] || "";
    const after = text[index + term.length] || "";
    if (!/^[a-z\d_]+$/i.test(term) || !/[a-z\d_]/i.test(before + after)) result.push(index);
    from = index + Math.max(1, term.length);
  }
  return result;
}

function isNegated(text, index, length) {
  const before = text.slice(Math.max(0, index - 24), index);
  const after = text.slice(index + length, index + length + 24).trimStart();
  return /(?:并非|不是|不做|不属于|不涉及|不讲|不教|不聊|非)(?:这类|关于|任何|一个|行业|领域|类|的|该|此|\s)*$/u.test(before)
    || /^(?:不是|并非|不属于)(?:我|本人|本账号)?的?(?:行业|领域|主业|内容方向|方向)/u.test(after);
}

function matchText(value, groups) {
  const text = fold(value);
  const coverage = new Set();
  const terms = [];
  const negative = [];
  for (const [groupIndex, group] of groups.entries()) {
    for (const raw of group) {
      const term = fold(raw);
      const positions = occurrences(text, term);
      const positive = positions.some((index) => !isNegated(text, index, term.length));
      if (positive) {
        coverage.add(groupIndex);
        terms.push(raw);
      }
      if (positions.some((index) => isNegated(text, index, term.length))) negative.push(raw);
    }
  }
  return { coverage, terms: unique(terms), negative: unique(negative) };
}

function excerpt(value, terms, maximum = 200) {
  const text = clean(value);
  const lowered = text.toLowerCase();
  const indices = terms.map((term) => lowered.indexOf(fold(term))).filter((index) => index >= 0);
  const start = Math.max(0, (indices.length ? Math.min(...indices) : 0) - 40);
  return `${start ? "..." : ""}${text.slice(start, start + maximum)}${text.length > start + maximum ? "..." : ""}`;
}

function ownedNotes(notes, userId) {
  if (!USER_ID.test(userId)) return [];
  const ids = new Set();
  const contents = new Set();
  const result = [];
  for (const note of (Array.isArray(notes) ? notes : []).slice(0, 80)) {
    if (!note || note.source !== "profile" || typeof note.authorId !== "string" || note.authorId.toLowerCase() !== userId) continue;
    const id = clean(note.id, 100).toLowerCase();
    if (!USER_ID.test(id) || ids.has(id)) continue;
    const title = clean(note.title, 200);
    const description = clean(note.description);
    const tags = tagsOf(note.tags);
    const fingerprint = fold([title, description, ...tags].join("\n")).replace(/\s+/g, "");
    if (!fingerprint || contents.has(fingerprint)) continue;
    ids.add(id);
    contents.add(fingerprint);
    result.push({ id, title, description, tags });
    if (result.length === MAX_NOTES) break;
  }
  return result;
}

function assessCreatorRelevance({ keyword = "", creator = {}, notes = [] } = {}) {
  const groups = keywordGroups(keyword);
  const userId = typeof creator?.userId === "string" ? creator.userId.toLowerCase() : "";
  const publicTags = tagsOf(creator?.tags);
  const samples = ownedNotes(notes, userId);
  const base = {
    version: RELEVANCE_VERSION, keyword: clean(keyword, 80), userId,
    status: "insufficient", matched: false, label: "证据不足",
    reasons: [], tags: publicTags, matchedNotes: 0, totalNotes: samples.length, matchedTerms: [], evidence: [],
  };
  if (!groups.length || !USER_ID.test(userId)) return { ...base, reasons: ["关键词或公开主页身份无法确认"] };

  const description = withoutHashtags(creator?.description);
  const profile = matchText(description, groups);
  const tagMatch = matchText(publicTags.join("\n"), groups);
  const identityCoverage = new Set([...profile.coverage, ...tagMatch.coverage]);
  const identityMatches = identityCoverage.size === groups.length;
  const evidence = [];
  if (profile.terms.length) evidence.push({ kind: "profile", text: excerpt(description, profile.terms), terms: profile.terms });
  for (const tag of publicTags) {
    const matched = matchText(tag, groups);
    if (matched.terms.length) evidence.push({ kind: "tag", text: tag, terms: matched.terms });
  }

  let matchedNotes = 0;
  for (const note of samples) {
    const content = [withoutHashtags(note.title), withoutHashtags(note.description)].filter(Boolean).join("\n");
    const direct = matchText(content, groups);
    const tagged = matchText(note.tags.join("\n"), groups);
    if (direct.coverage.size !== groups.length) continue;
    matchedNotes += 1;
    const terms = unique([...direct.terms, ...tagged.terms]);
    const actualText = [note.title, note.description, ...note.tags.map((tag) => `#${tag}`)].filter(Boolean).join("\n");
    evidence.push({ kind: "note", noteId: note.id, text: excerpt(actualText, terms), terms });
  }

  const evidenceOrder = { profile: 0, note: 1, tag: 2 };
  const prioritizedEvidence = [...evidence].sort((left, right) => evidenceOrder[left.kind] - evidenceOrder[right.kind]);
  const result = {
    ...base, matchedNotes,
    matchedTerms: unique(evidence.flatMap((entry) => entry.terms)).slice(0, 24),
    evidence: prioritizedEvidence.slice(0, 20),
  };
  const deniedField = matchText(description, keywordGroups(keyword, true));
  if (deniedField.negative.length) return {
    ...result, status: "unmatched", label: "领域不符",
    reasons: ["主页简介明确否定了该领域，不能仅凭搜索命中或标签判为匹配"],
  };

  // One post, a name or tags alone cannot establish a creator's field.
  const ratio = samples.length ? matchedNotes / samples.length : 0;
  const corroborated = identityMatches && samples.length >= 2 && matchedNotes >= 2 && ratio >= 0.5;
  const contentLed = samples.length >= 3 && matchedNotes >= 2 && ratio >= 0.6;
  if (corroborated || contentLed) return {
    ...result, status: "matched", matched: true,
    label: corroborated ? "资料与内容相符" : "多篇内容相符",
    reasons: [
      ...(identityMatches ? ["公开主页简介或标签提供领域佐证"] : []),
      `${samples.length} 篇本人公开内容样本中 ${matchedNotes} 篇标题或摘要与领域相关`,
    ],
  };
  if (samples.length < 3 && !corroborated) return {
    ...result, reasons: ["本人公开内容样本不足，不能凭昵称、单篇内容或标签判断行业归属"],
  };
  return {
    ...result, status: "unmatched", label: "领域不符",
    reasons: [matchedNotes < 2
      ? "缺少至少两篇本人内容的直接依据，标签或简介提及不足以确认领域"
      : "相关内容在公开样本中的占比不足，不能将偶尔涉及的主题当作主要领域"],
  };
}

module.exports = { RELEVANCE_VERSION, assessCreatorRelevance };
