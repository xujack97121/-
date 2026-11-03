import assert from "node:assert/strict";
import { CREATOR_FOLLOWER_PRESETS, DEFAULT_CREATOR_STATE, creatorCountLabel, mergeCreatorSnapshot, normalizeCreator, normalizeCreatorRelevance, normalizeCreatorSnapshot, normalizeCreatorState, restoreCreatorState, validateCreatorSearch } from "../../frontend/src/features/creators/creator-discovery.js";

const userId = "65b200000000000000000001";
const relevance = { version: 2, keyword: "护肤", userId, status: "matched", matched: true, label: "资料与内容相符",
  tags: ["护肤"], matchedNotes: 2, totalNotes: 4, evidence: [
    { kind: "profile", text: "分享护肤成分与真实体验", terms: ["护肤"] },
    { kind: "note", noteId: "65c200000000000000000001", text: "护肤成分研究", terms: ["护肤"] },
    { kind: "note", noteId: "65c200000000000000000002", text: "护肤体验复盘", terms: ["护肤"] },
  ] };
const creator = { userId, profileUrl: `https://www.xiaohongshu.com/user/profile/${userId}`, nickname: "护肤记录", followers: 12000, followerLabel: "1.2万", avatarUrl: "https://sns-avatar-qc.xhscdn.com/avatar/fixture.jpg", relevance };
const search = (patch = {}) => validateCreatorSearch({ ...DEFAULT_CREATOR_STATE, keyword: "  护肤  ", ...patch });

assert.equal(normalizeCreatorState(null).preset, "all");
assert.equal(normalizeCreatorState({ snapshot: null }).snapshot.phase, "idle");
assert.equal(normalizeCreatorState({ preset: "missing" }).preset, "all");
assert.deepEqual(search().query, { keyword: "护肤", minFollowers: null, maxFollowers: null, limit: 30 });
for (const preset of CREATOR_FOLLOWER_PRESETS.filter((option) => option.id !== "custom")) {
  const result = search({ preset: preset.id });
  assert.equal(result.ok, true);
  assert.equal(result.query.minFollowers, preset.minFollowers);
  assert.equal(result.query.maxFollowers, preset.maxFollowers);
}
assert.deepEqual(search({ preset: "custom", minFollowers: "0", maxFollowers: "12345" }).query, { keyword: "护肤", minFollowers: 0, maxFollowers: 12345, limit: 30 });
assert.deepEqual(search({ preset: "custom", minFollowers: "500000" }).query, { keyword: "护肤", minFollowers: 500000, maxFollowers: null, limit: 30 });
assert.equal(search({ keyword: " " }).field, "keyword");
assert.equal(search({ keyword: "词".repeat(81) }).field, "keyword");
assert.equal(search({ keyword: "护肤\n美妆" }).ok, false);
assert.equal(search({ keyword: " ＡＩ\u200b " }).query.keyword, "AI");
assert.equal(search({ preset: "custom", minFollowers: "-1" }).field, "minFollowers");
assert.equal(search({ preset: "custom", minFollowers: "1.5" }).field, "minFollowers");
assert.equal(search({ preset: "custom", maxFollowers: "1e5" }).field, "maxFollowers");
assert.equal(search({ preset: "custom", minFollowers: "9007199254740992" }).ok, false);
assert.equal(search({ preset: "custom", minFollowers: "10", maxFollowers: "9" }).field, "maxFollowers");
assert.equal(search({ limit: 101 }).field, "limit");
assert.equal(search({ limit: "" }).field, "limit");
assert.equal(creatorCountLabel(null), "未公开");
assert.equal(creatorCountLabel(0), "0");
assert.equal(creatorCountLabel(12000, "1.2万"), "1.2万");
assert.equal(normalizeCreator({ ...creator, followers: null }).followers, null);
assert.equal(normalizeCreator({ ...creator, followers: "" }).followers, null);
assert.equal(normalizeCreator({ ...creator, avatarUrl: "https://untrusted.example/avatar.jpg" }).avatarUrl, "");
assert.equal(normalizeCreator({ ...creator, profileUrl: "https://untrusted.example/user/profile/" + userId }), null);
assert.equal(normalizeCreator({ ...creator, userId: userId + "invalid" }), null);
assert.equal(normalizeCreator({ ...creator, profileUrl: `https://www.xiaohongshu.com/user/profile/${userId}?xsec_token=public-navigation&xsec_source=pc_search&redirect=blocked` }).profileUrl, creator.profileUrl + "?xsec_token=public-navigation&xsec_source=pc_search");
assert.equal(normalizeCreatorSnapshot({ keyword: "护肤", creators: [creator, creator, { ...creator, userId: "bad" }] }).creators.length, 1);
assert.equal(normalizeCreatorSnapshot({ keyword: "家居", creators: [creator] }).creators.length, 0);
assert.equal(normalizeCreatorSnapshot({ keyword: "护肤", creators: [{ ...creator, relevance: undefined }] }).creators.length, 0);
assert.equal(normalizeCreatorRelevance({ ...relevance, version: 1 }, userId, "护肤"), null);
assert.equal(normalizeCreatorRelevance({ ...relevance, userId: "65b200000000000000000002" }, userId, "护肤"), null);
assert.equal(normalizeCreatorRelevance({ ...relevance, status: "insufficient" }, userId, "护肤"), null);
assert.equal(normalizeCreatorRelevance({ ...relevance, matched: false }, userId, "护肤"), null);
assert.equal(normalizeCreatorRelevance({ ...relevance, evidence: [] }, userId, "护肤"), null);
assert.equal(normalizeCreatorRelevance({ ...relevance, evidence: [{ kind: "profile", text: "旅行记录", terms: ["护肤"] }] }, userId, "护肤"), null);
assert.equal(normalizeCreatorRelevance({ ...relevance, totalNotes: 9 }, userId, "护肤"), null);
assert.equal(normalizeCreatorRelevance({ ...relevance, matchedNotes: 1 }, userId, "护肤"), null);
assert.equal(normalizeCreatorRelevance({ ...relevance, evidence: [relevance.evidence[1], relevance.evidence[1]] }, userId, "护肤"), null);
assert.equal(normalizeCreatorRelevance({ ...relevance, evidence: relevance.evidence.map((entry) => entry.kind === "note" ? { ...entry, noteId: undefined } : entry) }, userId, "护肤"), null);
assert.equal(normalizeCreatorRelevance({ ...relevance, evidence: relevance.evidence.map((entry) => entry.kind === "profile" ? { ...entry, noteId: 123 } : entry) }, userId, "护肤").evidence[0].noteId, undefined);
assert.equal(normalizeCreatorRelevance({ ...relevance, keyword: "AI", evidence: relevance.evidence.map((entry) => ({ ...entry, text: "AI 实践", terms: ["AI"] })) }, userId, " ＡＩ\u200b ").keyword, "AI");
const current = normalizeCreatorSnapshot({ accountId: "a", runId: "run-a", revision: 5, phase: "searching", stage: "checking", keyword: "护肤", creators: [creator], candidates: 8, checked: 5, rejected: 2, insufficient: 2 });
assert.deepEqual([current.stage, current.candidates, current.checked, current.rejected, current.insufficient], ["checking", 8, 5, 2, 2]);
assert.equal(mergeCreatorSnapshot(current, { ...current, accountId: "b", revision: 9 }, { accountId: "a" }), current);
assert.equal(mergeCreatorSnapshot(current, { ...current, revision: 4, creators: [] }, { accountId: "a" }), current);
assert.equal(mergeCreatorSnapshot(current, { ...current, runId: "old-run", revision: 50 }, { accountId: "a" }), current);
const recovered = mergeCreatorSnapshot(current, { accountId: "a", phase: "idle" }, { accountId: "a", allowNewRun: true });
assert.equal(recovered.phase, "stopped");
assert.equal(recovered.creators.length, 1);
assert.equal(mergeCreatorSnapshot(recovered, { accountId: "a", phase: "idle" }, { accountId: "a", allowNewRun: true }), recovered);
assert.equal(mergeCreatorSnapshot(current, { ...current, runId: "new-run", revision: 1, creators: [] }, { accountId: "a", allowNewRun: true }).runId, "new-run");
assert.equal(mergeCreatorSnapshot(current, { ...current, revision: 6, phase: "completed" }, { accountId: "a" }).active, false);
const restored = restoreCreatorState({ keyword: "护肤", snapshot: current });
assert.equal(restored.snapshot.phase, "stopped");
assert.equal(restored.snapshot.active, false);
assert.equal(restored.snapshot.creators.length, 1);
assert.equal(restored.snapshot.runId, "run-a");
assert.equal(normalizeCreatorState({ snapshot: current }).snapshot.phase, "searching", "Live normalization must not interrupt a running search");
const legacy = restoreCreatorState({ keyword: "家居", preset: "under-1k", snapshot: { ...current, relevanceVersion: undefined, phase: "completed", message: "已匹配旧结果", creators: [{ ...creator, relevance: undefined }] } });
assert.equal(legacy.keyword, "家居");
assert.equal(legacy.preset, "under-1k");
assert.equal(legacy.snapshot.creators.length, 0);
assert.equal(legacy.snapshot.checked, 0);
assert.equal(legacy.snapshot.needsRecheck, true);
assert.equal(legacy.snapshot.message.includes("重新查找"), true);
assert.equal(legacy.snapshot.message.includes("已匹配旧结果"), false);
assert.equal(mergeCreatorSnapshot(legacy.snapshot, { accountId: "a", phase: "idle" }, { accountId: "a", allowNewRun: true }), legacy.snapshot);
assert.equal(restoreCreatorState({ keyword: "已编辑未搜索", snapshot: { ...current, phase: "completed" } }).snapshot.creators.length, 1, "Match belongs to searched keyword, not unsent input");
console.log("PASS: creator filters, safe cards, evidence/user/keyword ownership, public progress counts, legacy migration, normalization and account/run/revision guards");
