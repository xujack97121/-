const assert = require("node:assert/strict");
const { test } = require("node:test");
const { RELEVANCE_VERSION, assessCreatorRelevance } = require("../../backend/creators/creator-relevance.cjs");

const USER = "64bdb388000000001403b0c1";
const OTHER = "64bdb388000000001403b0c2";
const idOf = (index) => index.toString(16).padStart(24, "0");
const creator = (extra = {}) => ({ userId: USER, nickname: "阿禾的日常", description: "", tags: [], ...extra });
const notes = (...titles) => titles.map((title, index) => ({
  id: idOf(index + 1), authorId: USER, source: "profile", title, description: "", tags: [],
}));
const assess = (titles, extra = {}, keyword = "家居") => assessCreatorRelevance({
  keyword, creator: creator(extra), notes: notes(...titles),
});

test("recognized fields use related concepts and public identity plus two owned notes", () => {
  const result = assess(["小户型软装搭配实录", "分享衣柜收纳规划"], { tags: ["室内设计师", "原创分享"] });
  assert.equal(RELEVANCE_VERSION, 2);
  assert.equal(result.version, 2);
  assert.equal(result.keyword, "家居");
  assert.equal(result.userId, USER);
  assert.equal(result.status, "matched");
  assert.equal(result.matched, true);
  assert.equal(result.matchedNotes, 2);
  assert.equal(result.totalNotes, 2);
  assert.deepEqual(result.tags, ["室内设计师", "原创分享"]);
  assert.ok(result.evidence.some((item) => item.kind === "tag" && item.text === "室内设计师"));
  assert.equal(result.evidence.filter((item) => item.kind === "note").length, 2);
  assert.ok(result.matchedTerms.includes("软装"));
  assert.ok(result.matchedTerms.includes("收纳"));
});

test("multiple owned content samples can corroborate a field without profile keywords", () => {
  const result = assess(["租房改造的灯光记录", "客厅布置分享", "周末爬山记录"]);
  assert.equal(result.status, "matched");
  assert.equal(result.label, "多篇内容相符");
  assert.equal(result.totalNotes, 3);
  assert.equal(result.matchedNotes, 2);
});

test("nickname and search candidate metadata never count as field evidence", () => {
  const result = assess(["咖啡拉花练习", "周末烘焙蛋糕", "家常菜食谱"], {
    nickname: "家居收纳软装专家",
    searchKeyword: "家居",
    searchDescription: "家居设计师",
  });
  assert.equal(result.status, "unmatched");
  assert.equal(result.matchedNotes, 0);
  assert.equal(result.evidence.length, 0);
});

test("a relevant profile is not sufficient when owned content is unrelated", () => {
  const result = assess(["提拉米苏制作", "咖啡探店实录", "蛋糕烘焙配方"], {
    description: "专注家居软装",
    tags: ["家居博主"],
  });
  assert.equal(result.status, "unmatched");
  assert.equal(result.matched, false);
});

test("an occasional theme is not the creator's main field", () => {
  const result = assess(["客厅软装改造", "夏日甜品食谱", "咖啡拉花练习", "烘焙蛋糕配方", "周末美食探店"], {
    description: "分享生活与家居",
  });
  assert.equal(result.status, "unmatched");
  assert.equal(result.matchedNotes, 1);
});

test("a shared style adjective alone does not turn another industry into home content", () => {
  const result = assess(["奶油风美甲新款", "原木风配色美甲", "奶油风妆容分享"], { description: "分享美甲与彩妆" });
  assert.equal(result.status, "unmatched");
  assert.equal(result.matchedNotes, 0);
});

test("tags and hashtags alone cannot substitute for direct content evidence", () => {
  const result = assessCreatorRelevance({
    keyword: "家居", creator: creator({ tags: ["家居"] }),
    notes: notes("周末甜品 #家居", "拉花练习 #软装", "蛋糕烘焙 #收纳").map((note) => ({
      ...note, tags: ["家居", "软装", "收纳"],
    })),
  });
  assert.equal(result.status, "unmatched");
  assert.equal(result.matchedNotes, 0);
  assert.equal(result.matched, false);
});

test("tag stuffing cannot inflate the related-content ratio", () => {
  const result = assessCreatorRelevance({
    keyword: "家居", creator: creator({ description: "专注家居设计" }),
    notes: notes("客厅软装记录", "卧室布置记录", "深蹲训练", "跑步记录", "普拉提练习", "有氧训练", "瑜伽实录", "游泳训练")
      .map((note) => ({ ...note, tags: ["家居"] })),
  });
  assert.equal(result.totalNotes, 8);
  assert.equal(result.matchedNotes, 2);
  assert.equal(result.status, "unmatched");
});

test("one post or sparse evidence remains insufficient", () => {
  const result = assess(["原木风家具搭配"], { description: "家居设计师" });
  assert.equal(result.status, "insufficient");
  assert.equal(result.matched, false);
  assert.equal(result.totalNotes, 1);
});

test("search results and posts authored by other people never establish ownership", () => {
  const result = assessCreatorRelevance({
    keyword: "家居",
    creator: creator({ description: "家居博主" }),
    notes: [
      ...notes("收纳技巧", "软装技巧").map((note) => ({ ...note, source: "search" })),
      ...notes("客厅布置", "卧室布置", "租房改造").map((note) => ({ ...note, authorId: OTHER })),
      { ...notes("家具推荐")[0], authorId: undefined },
    ],
  });
  assert.equal(result.totalNotes, 0);
  assert.equal(result.status, "insufficient");
  assert.equal(result.evidence.filter((item) => item.kind === "note").length, 0);
});

test("repeated IDs or identical content cannot inflate the evidence count", () => {
  const first = notes("软装搭配记录")[0];
  const result = assessCreatorRelevance({
    keyword: "家居", creator: creator({ tags: ["家居"] }),
    notes: [first, { ...first }, { ...first, id: idOf(2) }, { ...first, id: idOf(3), title: "软装 搭配记录" }],
  });
  assert.equal(result.totalNotes, 1);
  assert.equal(result.status, "insufficient");
});

test("at most eight distinct owned notes are sampled", () => {
  const titles = Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 次客厅软装记录`);
  const result = assess(titles);
  assert.equal(result.totalNotes, 8);
  assert.equal(result.matchedNotes, 8);
  assert.equal(result.status, "matched");
});

test("profile tags cannot displace owned content from the displayed proof", () => {
  const result = assess(["家居收纳记录", "卧室软装记录", "客厅布置记录"], {
    description: "家居设计师",
    tags: Array.from({ length: 20 }, (_, index) => `家居标签${index}`),
  });
  assert.equal(result.status, "matched");
  assert.equal(result.evidence.filter((entry) => entry.kind === "note").length, 3);
  assert.equal(result.evidence.slice(0, 3).filter((entry) => entry.kind === "note").length, 2);
});

test("specific phrases are not broadened into an unrelated parent industry", () => {
  assert.equal(assess(["家具搭配", "收纳整理", "客厅布置"], { description: "家居设计师" }, "家具维修").status, "unmatched");
  assert.equal(assess(["养猫经验", "猫粮选择", "宠物护理"], { description: "养猫日常" }, "宠物摄影").status, "unmatched");
  assert.equal(assess(["摄影构图", "镜头测评", "人像摄影"], {}, "宠物摄影").status, "unmatched");
  assert.equal(assess(["收纳规划", "软装搭配", "卧室布置"], {}, "全屋智能").status, "unmatched");
  assert.equal(assess(["全屋智能布线", "全屋智能网关选择", "全屋智能联动"], {}, "全屋智能").status, "matched");
});

test("multiple keyword facets must appear together in direct content", () => {
  assert.equal(assess(["软装搭配", "卧室布置", "客厅布置"], { description: "家居收纳" }, "家居 收纳").status, "unmatched");
  const result = assess(["客厅收纳规划", "衣柜收纳整理", "厨房收纳实录"], {}, "家居、收纳");
  assert.equal(result.status, "matched");
});

test("pasted topic markers preserve the query binding without changing its field", () => {
  const result = assess(["客厅软装", "卧室布置", "家居收纳"], {}, "#家居#");
  assert.equal(result.status, "matched");
  assert.equal(result.keyword, "#家居#");
  assert.equal(assess(["客厅收纳", "衣柜收纳", "厨房收纳"], {}, "#家居 #收纳").status, "matched");
});

test("unrecognized industry phrases can match using their actual owned content", () => {
  const result = assess(["工业阀门选型记录", "工业阀门日常维护", "工业阀门密封测试"], {}, "工业阀门行业");
  assert.equal(result.status, "matched");
  assert.ok(result.matchedTerms.includes("工业阀门"));
});

test("Latin short keywords require word boundaries", () => {
  assert.equal(assess(["painting", "daily train", "braiding tutorial"], {}, "AI").status, "unmatched");
  assert.equal(assess(["AI workflow", "AI agent design", "大模型评测"], {}, "ＡＩ").status, "matched");
});

test("explicit profile denial rejects a field even with apparently matching notes", () => {
  for (const description of ["我不是家居博主", "家居不是我的领域", "不属于居家领域"]) {
    assert.equal(assess(["软装搭配", "卧室布置", "客厅收纳"], { description }).status, "unmatched");
  }
});

test("denying a subfield does not negate a broader field or an ordinary positive sentence", () => {
  assert.equal(assess(["衣柜收纳整理", "厨房收纳规划"], { description: "不做装修，专注收纳" }).status, "matched");
  assert.equal(assess(["卧室布置", "客厅软装"], { description: "非常喜欢家居分享" }).status, "matched");
  assert.equal(assess(["卧室布置", "客厅软装"], { description: "非专业家居爱好者，记录自己的软装" }).status, "matched");
});

test("negated content keywords are not counted as positive direct evidence", () => {
  const result = assess(["不是家居内容", "不做家居分享", "不聊家居话题"], { description: "日常记录" });
  assert.equal(result.status, "unmatched");
  assert.equal(result.matchedNotes, 0);
});

test("invalid identities and malformed or missing data fail closed", () => {
  for (const value of [undefined, {}, { keyword: "家居", creator: { userId: "invalid" } }]) {
    assert.equal(assessCreatorRelevance(value).status, "insufficient");
  }
  const result = assessCreatorRelevance({
    keyword: { dangerous: "家居" },
    creator: creator({ description: { text: "家居" }, tags: [null, {}, "家居"] }),
    notes: [null, {}, { id: "unsafe", source: "profile", authorId: USER }],
  });
  assert.equal(result.matched, false);
  assert.equal(result.totalNotes, 0);
});

test("outputs stay public, bounded, and tied to their exact creator and keyword", () => {
  const result = assessCreatorRelevance({
    keyword: " 家居\u200b ",
    creator: creator({ description: `家居设计${"内容".repeat(3000)}`, token: "private-token", cookie: "private-cookie" }),
    notes: notes("软装记录一", "客厅布置记录二", "卧室布置记录三"),
  });
  assert.equal(result.keyword, "家居");
  assert.equal(result.userId, USER);
  assert.ok(result.evidence.every((item) => item.text.length <= 206));
  assert.ok(result.evidence.every((item) => item.kind !== "note" || /^[a-f\d]{24}$/.test(item.noteId)));
  assert.equal(JSON.stringify(result).includes("private-"), false);
});
