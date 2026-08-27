import assert from "node:assert/strict";

const state = {};
let messageListener;

globalThis.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onMessage: { addListener(listener) { messageListener = listener; } },
  },
  sidePanel: { setPanelBehavior: async () => {} },
  storage: {
    local: {
      async get(keys) { return Object.fromEntries(keys.filter((key) => key in state).map((key) => [key, state[key]])); },
      async set(values) { Object.assign(state, values); },
    },
  },
};

await import(`../public/service-worker.js?test=${Date.now()}`);
assert.equal(typeof messageListener, "function");

async function deliver(url, json) {
  return new Promise((resolve, reject) => {
    const keepAlive = messageListener(
      { type: "XHS_CAPTURE", url, json },
      { tab: { url: "https://www.xiaohongshu.com/explore/demo-note" } },
      (result) => result?.error ? reject(new Error(result.error)) : resolve(result),
    );
    assert.equal(keepAlive, true);
  });
}

await deliver("https://www.xiaohongshu.com/api/sns/web/v1/search/notes", {
  data: {
    items: [{
      id: "69abcdef0000000012345678",
      xsec_token: "token-public=",
      note_card: {
        display_title: "公开笔记标题",
        type: "video",
        time: "2026-08-03 10:30",
        user: { nickname: "示例作者", user_id: "123456789012" },
        interact_info: { liked_count: "1.2万" },
      },
    }, {
      id: "6a47919900000000160277c9",
      note_card: {
        display_title: "缺少发布时间的搜索结果",
        type: "normal",
        user: { nickname: "示例作者" },
        interact_info: { liked_count: "101" },
      },
    }],
  },
});

await deliver("https://www.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-001", {
  data: {
    comments: [{
      id: "comment-001",
      content: "示例公开评论",
      create_time: 1785200000,
      ip_location: "IP属地：上海",
      user: { nickname: "示例用户", user_id: "987654321000" },
    }],
  },
});

assert.equal(state.collectorNotes.length, 2);
assert.equal(state.collectorNotes[0].likes, 12000);
assert.equal(state.collectorNotes[0].type, "视频");
assert.equal(state.collectorNotes[0].authorId, "1234••••012");
assert.equal(state.collectorNotes[0].time, "2026-08-03 10:30");
assert.equal(state.collectorNotes[0].link, "https://www.xiaohongshu.com/explore/69abcdef0000000012345678?xsec_token=token-public%3D&xsec_source=pc_search&source=web_search_result_notes");
assert.match(state.collectorNotes[1].time, /^2026-07-03 \d{2}:40$/);
assert.equal(state.collectorComments.length, 1);
assert.equal(state.collectorComments[0].region, "上海");
assert.equal(state.collectorComments[0].authorId, "9876••••000");
assert.equal(state.captureStats.captures, 2);

console.log("service worker normalization: passed");
