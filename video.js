/*
 * 動画書き出し機能 / video.js
 * Phase 1: canvasレンダラ（LINE風UIの静止描画）
 * 実装プラン: docs/video-export-plan.md
 *
 * 方針: 各関数の【本体】は GitHub Copilot で補完する。
 *      下のコメント仕様に沿って補完し、drawChrome() で
 *      LINE風の電話画面が「静止画として」正しく描けることが Phase 1 のゴール。
 *      （吹き出し=Phase 2 / アニメ=Phase 3 はまだ書かない）
 *
 * 参照元:
 *   - 配色/寸法: index.html の :root と各CSSクラス（.phone/.screen/.phead/.nav/.pinput 等）
 *   - python版の対応: api/generate.py の C_* と build_chrome()
 */

'use strict';

/* ===== 配色（index.html の :root から転記） ===== */
const V = {
  green:   '#06C755', // ヘッダ・送信ボタン・自分の吹き出し
  greenD:  '#05a847',
  chatbg:  '#8AABD2', // チャット背景
  ink:     '#1a1d21',
  mute:    '#9aa0a6', // プレースホルダ等
  white:   '#ffffff',
  bezel:   '#0b0b0d', // 電話フレーム・Dynamic Island
  inputBg: '#f4f5f7', // 入力バー背景
  inputFld:'#ffffff', // 入力フィールド
  recvTx:  '#1a1a1a', // 相手の吹き出し文字
  statusSub:'#dff5e6',// ヘッダのステータス文言色
};

/* ===== 論理座標系（9:16）。実出力はこれを SCALE 倍した解像度 ===== */
const VW = 360;   // 論理幅
const VH = 640;   // 論理高さ（VW:VH = 9:16）
const SCALE = 2;  // 出力倍率。720x1280。GIF等で必要なら変更

/* ===== レイアウト寸法（論理座標。CSS .phone=300x533 を基準に 360x640 へスケール） ===== */
const L = {
  phone:   { pad: 13, radius: 50 },           // 電話の外枠：内側パディングと角丸
  screen:  { radius: 38 },                     // 画面の角丸
  headerH: 132,                                // 緑ヘッダの高さ（ステータスバー＋ナビ）
  inputH:  62,                                 // 下部入力バーの高さ
  island:  { w: 94, h: 23, top: 12 },          // Dynamic Island
  chatPad: 14,                                 // チャット左右パディング
};

/* ===========================================================================
 * setupCanvas()
 *  - <canvas> を生成し、実ピクセルを VW*SCALE × VH*SCALE に設定。
 *  - ctx.scale(SCALE, SCALE) して、以降は論理座標(VW×VH)で描けるようにする。
 *  - 文字のにじみ対策に ctx の textBaseline 等は各 draw 側で設定。
 *  返り値: { canvas, ctx }
 * =========================================================================== */
function setupCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = VW * SCALE;
  canvas.height = VH * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  return { canvas, ctx };
}

/* ===========================================================================
 * roundRect(ctx, x, y, w, h, r)
 *  - 角丸矩形のパスを引くヘルパー（fill/stroke は呼び出し側）。
 *  - r は数値、または {tl,tr,br,bl} で四隅個別指定もできると後段(ヘッダ/入力バー)で便利。
 * =========================================================================== */
function roundRect(ctx, x, y, w, h, r) {
  let tl, tr, br, bl;
  if (typeof r === 'number') {
    tl = tr = br = bl = r;
  } else {
    tl = r.tl || 0;
    tr = r.tr || 0;
    br = r.br || 0;
    bl = r.bl || 0;
  }
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

/* ===========================================================================
 * drawPhoneFrame(ctx)
 *  - 背景全体を chatbg ではなく、まず電話の外枠(bezel, 角丸 L.phone.radius)を
 *    論理座標いっぱい(0,0,VW,VH)に近い形で描く。
 *  - その内側 L.phone.pad だけ控えた領域に、画面(screen)を chatbg・角丸 L.screen.radius で描く。
 *  - 以降の描画基準にするため、画面の矩形 {x,y,w,h} を返す（drawHeader/drawInputBar で使う）。
 *  返り値: screenRect = { x, y, w, h }
 *  参照: CSS .phone(border-radius:42, padding:11) / .screen(border-radius:32)
 * =========================================================================== */
function drawPhoneFrame(ctx) {
  // Draw bezel (phone frame)
  ctx.fillStyle = V.bezel;
  roundRect(ctx, 0, 0, VW, VH, L.phone.radius);
  ctx.fill();
  
  // Draw screen (chatbg)
  const screenRect = {
    x: L.phone.pad,
    y: L.phone.pad,
    w: VW - 2 * L.phone.pad,
    h: VH - 2 * L.phone.pad
  };
  ctx.fillStyle = V.chatbg;
  roundRect(ctx, screenRect.x, screenRect.y, screenRect.w, screenRect.h, L.screen.radius);
  ctx.fill();
  
  return screenRect;
}

/* ===========================================================================
 * drawStatusBar(ctx, screenRect)
 *  - 画面上部に「9:41」(左, 白, 太字) と、右に電波4本・バッテリーを描く。
 *  - Dynamic Island(L.island, bezel, 角丸=高さの半分=ピル形)を画面上部中央に重ねる。
 *  参照: CSS .statusbar/.sig/.batt/.island, python build_chrome の該当部分
 * =========================================================================== */
function drawStatusBar(ctx, screenRect) {
  // Draw time "9:41" on the left
  ctx.fillStyle = V.white;
  ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('9:41', screenRect.x + 12, screenRect.y + 8);
  
  // Draw signal strength (4 bars)
  const signalX = screenRect.x + screenRect.w - 48;
  const signalY = screenRect.y + 8;
  const barW = 2;
  const barGap = 1;
  for (let i = 0; i < 4; i++) {
    const barH = 2 + i * 2;
    ctx.fillRect(signalX + i * (barW + barGap), signalY + (8 - barH), barW, barH);
  }
  
  // Draw battery
  const battX = screenRect.x + screenRect.w - 24;
  const battY = screenRect.y + 7;
  ctx.strokeStyle = V.white;
  ctx.lineWidth = 1;
  ctx.strokeRect(battX, battY, 14, 8);
  ctx.fillRect(battX + 14, battY + 2, 2, 4);
  ctx.fillStyle = V.white;
  ctx.fillRect(battX + 1, battY + 1, 12, 6);
  
  // Draw Dynamic Island
  const islandX = screenRect.x + (screenRect.w - L.island.w) / 2;
  const islandY = screenRect.y + L.island.top;
  ctx.fillStyle = V.bezel;
  roundRect(ctx, islandX, islandY, L.island.w, L.island.h, L.island.h / 2);
  ctx.fill();
}

/* ===========================================================================
 * drawHeader(ctx, screenRect, name, status)
 *  - 画面上部に緑(V.green)のヘッダ帯(高さ L.headerH, 上の角だけ screen に合わせて角丸)。
 *  - 中身: 戻る「‹」(白) → 丸アバター(白地に相手頭文字 name[0] を緑で) →
 *         name(白・太字) と その下に status(V.statusSub) → 右端に「⋮」相当のドット3つ(白)。
 *  - 上部には drawStatusBar を含める（呼び出し順は drawChrome 側で調整可）。
 *  参照: CSS .nav/.av/.nm/.st/.menu, python build_chrome
 * =========================================================================== */
function drawHeader(ctx, screenRect, name, status) {
  // Draw header background (green)
  ctx.fillStyle = V.green;
  roundRect(ctx, screenRect.x, screenRect.y, screenRect.w, L.headerH, { tl: L.screen.radius, tr: L.screen.radius, br: 0, bl: 0 });
  ctx.fill();
  
  // Draw back button "‹"
  ctx.fillStyle = V.white;
  ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('‹', screenRect.x + 12, screenRect.y + L.headerH / 2);
  
  // Draw avatar circle (white background)
  const avatarX = screenRect.x + 50;
  const avatarY = screenRect.y + L.headerH / 2;
  const avatarR = 18;
  ctx.fillStyle = V.white;
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarR, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw avatar text (first character of name)
  ctx.fillStyle = V.green;
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(name[0], avatarX, avatarY);
  ctx.textAlign = 'left';
  
  // Draw name and status
  ctx.fillStyle = V.white;
  ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(name, screenRect.x + 90, screenRect.y + L.headerH / 2 - 12);
  
  ctx.fillStyle = V.statusSub;
  ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(status, screenRect.x + 90, screenRect.y + L.headerH / 2 + 6);
  
  // Draw menu dots "⋮"
  ctx.fillStyle = V.white;
  const dotsX = screenRect.x + screenRect.w - 18;
  const dotsY = screenRect.y + L.headerH / 2;
  const dotR = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(dotsX, dotsY - 8 + i * 8, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Draw status bar on top
  drawStatusBar(ctx, screenRect);
}

/* ===========================================================================
 * drawInputBar(ctx, screenRect)
 *  - 画面下部に入力バー(高さ L.inputH, V.inputBg, 下の角だけ角丸)。
 *  - 中身: 左に「＋」(V.mute) → 角丸の白フィールドに「メッセージを入力」(V.mute) →
 *         右に緑(V.green)の丸い送信ボタンに「➤」(白)。
 *  参照: CSS .pinput/.plus/.fld/.send, python build_chrome の入力バー部分
 * =========================================================================== */
function drawInputBar(ctx, screenRect) {
  // Draw input bar background
  const inputY = screenRect.y + screenRect.h - L.inputH;
  ctx.fillStyle = V.inputBg;
  roundRect(ctx, screenRect.x, inputY, screenRect.w, L.inputH, { tl: 0, tr: 0, br: L.screen.radius, bl: L.screen.radius });
  ctx.fill();
  
  // Draw plus button
  ctx.fillStyle = V.mute;
  ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('＋', screenRect.x + 24, inputY + L.inputH / 2);
  ctx.textAlign = 'left';
  
  // Draw input field (white rounded rectangle)
  const fieldX = screenRect.x + 50;
  const fieldY = inputY + 8;
  const fieldW = screenRect.w - 120;
  const fieldH = L.inputH - 16;
  ctx.fillStyle = V.inputFld;
  roundRect(ctx, fieldX, fieldY, fieldW, fieldH, 8);
  ctx.fill();
  
  // Draw placeholder text
  ctx.fillStyle = V.mute;
  ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('メッセージを入力', fieldX + 12, inputY + L.inputH / 2);
  
  // Draw send button (green circle)
  const sendX = screenRect.x + screenRect.w - 24;
  const sendY = inputY + L.inputH / 2;
  const sendR = 16;
  ctx.fillStyle = V.green;
  ctx.beginPath();
  ctx.arc(sendX, sendY, sendR, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw send arrow
  ctx.fillStyle = V.white;
  ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('➤', sendX, sendY);
}

/* ===========================================================================
 * drawChrome(ctx, name, status)
 *  - 1フレーム分の「地」を描く: drawPhoneFrame → drawStatusBar → drawHeader → drawInputBar。
 *  - 吹き出しエリア(chat領域)の矩形を返す（Phase 2 で吹き出しを置くため）。
 *    chatRect = { x, y, w, h } : 画面内のヘッダ下〜入力バー上、左右に L.chatPad。
 *  返り値: { screenRect, chatRect }
 * =========================================================================== */
function drawChrome(ctx, name, status) {
  // Draw phone frame
  const screenRect = drawPhoneFrame(ctx);
  
  // Draw header (includes status bar)
  drawHeader(ctx, screenRect, name, status);
  
  // Draw input bar
  drawInputBar(ctx, screenRect);
  
  // Calculate chat area
  const chatRect = {
    x: screenRect.x + L.chatPad,
    y: screenRect.y + L.headerH,
    w: screenRect.w - 2 * L.chatPad,
    h: screenRect.h - L.headerH - L.inputH
  };
  
  return { screenRect, chatRect };
}

/* ===========================================================================
 * Phase 2: 吹き出し描画 ＋ 折返し計算（実装: Claude）
 *   CSS .bubble / .msg を canvas で再現。ctx.measureText で正確に折返す。
 * =========================================================================== */

const BUBBLE = {
  font: 13,        // 吹き出しフォント(px, 論理座標)
  padX: 11,        // 左右余白
  padY: 7,         // 上下余白
  radius: 15,      // 角丸
  maxW: 210,       // 吹き出し最大幅(論理px)
  lineH: 19,       // 行高(px)
  gap: 8,          // 吹き出し間の縦間隔
  avatar: 26,      // アバター径
  avatarGap: 6,    // アバターと吹き出しの間隔
};

function bubbleFont(ctx) {
  ctx.font = `${BUBBLE.font}px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Segoe UI", sans-serif`;
}

// テキストを maxTextW(px) で折返して行配列を返す。明示改行(\n)も尊重。
function wrapText(ctx, text, maxTextW) {
  bubbleFont(ctx);
  const lines = [];
  for (const para of String(text).split('\n')) {
    if (para === '') { lines.push(''); continue; }
    let cur = '';
    for (const ch of para) {
      const test = cur + ch;
      if (ctx.measureText(test).width > maxTextW && cur !== '') {
        lines.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur !== '') lines.push(cur);
  }
  return lines.length ? lines : [''];
}

// 吹き出しの寸法を計算。返り値 { w, h, lines }
function measureBubble(ctx, text) {
  const maxTextW = BUBBLE.maxW - BUBBLE.padX * 2;
  const lines = wrapText(ctx, text, maxTextW);
  let longest = 0;
  for (const ln of lines) longest = Math.max(longest, ctx.measureText(ln).width);
  const w = Math.min(BUBBLE.maxW, Math.ceil(longest) + BUBBLE.padX * 2);
  const h = lines.length * BUBBLE.lineH + BUBBLE.padY * 2;
  return { w, h, lines };
}

// 1つの吹き出しを top(論理y) に描画。side: 'L'|'R'。返り値: 吹き出し高さ。
function drawBubble(ctx, side, text, top, chatRect, partnerInitial) {
  const { w, h, lines } = measureBubble(ctx, text);
  let bx;
  if (side === 'L') {
    // アバター（吹き出し下端に下揃え）
    const acx = chatRect.x + BUBBLE.avatar / 2;
    const acy = top + h - BUBBLE.avatar / 2;
    ctx.fillStyle = V.white;
    ctx.beginPath();
    ctx.arc(acx, acy, BUBBLE.avatar / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = V.green;
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(partnerInitial, acx, acy);
    ctx.textAlign = 'left';
    bx = chatRect.x + BUBBLE.avatar + BUBBLE.avatarGap;
    ctx.fillStyle = V.white;
  } else {
    bx = chatRect.x + chatRect.w - w;
    ctx.fillStyle = V.green;
  }
  // 吹き出し本体（淡い影付き）
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.12)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  roundRect(ctx, bx, top, w, h, BUBBLE.radius);
  ctx.fill();
  ctx.restore();
  // テキスト
  ctx.fillStyle = side === 'R' ? V.white : V.recvTx;
  bubbleFont(ctx);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((ln, i) => {
    ctx.fillText(ln, bx + BUBBLE.padX, top + BUBBLE.padY + i * BUBBLE.lineH);
  });
  return h;
}

// メッセージ配置を計算。返り値 [{ side, text, top, h }]。anchor: 'bottom'|'top'|'center'。
function computeLayout(ctx, messages, chatRect, anchor) {
  const heights = messages.map(m => measureBubble(ctx, m.text).h);
  const blockH = heights.reduce((a, b) => a + b, 0) + BUBBLE.gap * Math.max(0, messages.length - 1);
  const avail = chatRect.h;
  let top;
  if (blockH > avail || anchor === 'top') top = chatRect.y + 4;
  else if (anchor === 'center') top = chatRect.y + (avail - blockH) / 2;
  else top = chatRect.y + avail - blockH; // bottom（既定）
  return messages.map((m, i) => {
    const item = { side: m.side, text: m.text, top, h: heights[i] };
    top += heights[i] + BUBBLE.gap;
    return item;
  });
}

// メッセージ配列を chatRect に静止配置で描く。
function drawMessages(ctx, messages, chatRect, anchor, partnerInitial) {
  for (const m of computeLayout(ctx, messages, chatRect, anchor)) {
    drawBubble(ctx, m.side, m.text, m.top, chatRect, partnerInitial);
  }
}

// 1スライド（chrome + 吹き出し）を描く。opts: { name, status, messages, anchor }
function drawSlide(ctx, opts) {
  const { chatRect } = drawChrome(ctx, opts.name, opts.status);
  const initial = opts.name ? opts.name[0] : '?';
  drawMessages(ctx, opts.messages, chatRect, opts.anchor || 'bottom', initial);
}

/* ===========================================================================
 * Phase 3: アニメーション（実装: Claude）
 *   吹き出しを stagger(ms) 間隔で順次フェードイン＋下から浮き上がり。
 *   renderFrame(ctx, opts, t) = 経過 t(ms) の1フレーム描画（録画でも流用）。
 *   playSlide = requestAnimationFrame でプレビュー再生。
 * =========================================================================== */

const ANIM = { stagger: 800, appearDur: 650, endHold: 1500, rise: 0 };
const TYPING = { maxLead: 1100 }; // 「入力中…」のリード時間の上限(ms)。実際は「出る間隔」も超えない

// 「入力中…」インジケータ（相手=Lのみ）。対象メッセージの最終位置に小さな白バブル＋3点。
function drawTyping(ctx, top, h, chatRect, partnerInitial) {
  const bw = 52, bh = 30;
  const by = top + h - bh; // メッセージ下端に合わせる
  const acx = chatRect.x + BUBBLE.avatar / 2;
  const acy = by + bh - BUBBLE.avatar / 2;
  ctx.fillStyle = V.white;
  ctx.beginPath();
  ctx.arc(acx, acy, BUBBLE.avatar / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = V.green;
  ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(partnerInitial, acx, acy);
  ctx.textAlign = 'left';
  const bx = chatRect.x + BUBBLE.avatar + BUBBLE.avatarGap;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.12)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = V.white;
  roundRect(ctx, bx, by, bw, bh, 15);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = V.mute;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(bx + 15 + i * 11, by + bh / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// アニメ総尺(ms)
function totalDuration(opts) {
  const stagger = opts.stagger ?? ANIM.stagger;
  return Math.max(0, opts.messages.length - 1) * stagger
    + (opts.appearDur ?? ANIM.appearDur)
    + (opts.endHold ?? ANIM.endHold);
}

// 経過 t(ms) の1フレームを描画。
function renderFrame(ctx, opts, t) {
  const stagger = opts.stagger ?? ANIM.stagger;
  const appearDur = opts.appearDur ?? ANIM.appearDur;
  const typingLead = Math.min(TYPING.maxLead, stagger);
  ctx.clearRect(0, 0, VW, VH);
  if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, VW, VH); } // 録画時の背景（角丸外）
  const { chatRect } = drawChrome(ctx, opts.name, opts.status);
  const initial = opts.name ? opts.name[0] : '?';
  const layout = computeLayout(ctx, opts.messages, chatRect, opts.anchor || 'bottom');
  layout.forEach((m, i) => {
    const appearAt = i * stagger;
    if (t >= appearAt) {
      const p = Math.min(1, (t - appearAt) / appearDur);
      ctx.save();
      ctx.globalAlpha = p;
      ctx.translate(0, (1 - p) * ANIM.rise);
      drawBubble(ctx, m.side, m.text, m.top, chatRect, initial);
      ctx.restore();
    } else if (m.side === 'L' && t >= appearAt - typingLead) {
      const tp = Math.min(1, (t - (appearAt - typingLead)) / appearDur);
      ctx.save();
      ctx.globalAlpha = tp;
      drawTyping(ctx, m.top, m.h, chatRect, initial); // 入力中も同じ速度でフェードイン
      ctx.restore();
    }
  });
}

// プレビュー再生。onFrame(t,total)/onDone は任意。
function playSlide(ctx, opts) {
  const total = totalDuration(opts);
  const start = performance.now();
  (function loop(now) {
    const t = now - start;
    renderFrame(ctx, opts, t);
    if (opts.onFrame) opts.onFrame(t, total);
    if (t < total) requestAnimationFrame(loop);
    else if (opts.onDone) opts.onDone();
  })(start);
}

/* ===========================================================================
 * Phase 4: 録画（実装: Claude）
 *   canvas.captureStream + MediaRecorder で録画。背景は opts.bg（既定 白）。
 *   format 'mp4' を優先し、非対応なら webm にフォールバック。
 *   返り値: Promise<{ blob, ext }>。onProgress(0..1) は任意。
 * =========================================================================== */
function pickVideoMime(format) {
  if (format === 'mp4') {
    for (const m of ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=h264', 'video/mp4']) {
      if (MediaRecorder.isTypeSupported(m)) return { mime: m, ext: 'mp4' };
    }
  }
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(m)) return { mime: m, ext: 'webm' };
  }
  return { mime: '', ext: 'webm' };
}

// 録画用の軽量フレーム描画器。動かない部分(chrome)を1枚に焼き、layoutを1度だけ計算。
// 返り値 drawAt(t) は「焼いた地＋その時刻に出ている吹き出し／入力中」を ctx に描く。
function buildSlideRenderer(ctx, recOpts) {
  const chrome = document.createElement('canvas');
  chrome.width = VW * SCALE; chrome.height = VH * SCALE;
  const cctx = chrome.getContext('2d'); cctx.scale(SCALE, SCALE);
  if (recOpts.bg) { cctx.fillStyle = recOpts.bg; cctx.fillRect(0, 0, VW, VH); }
  const { chatRect } = drawChrome(cctx, recOpts.name, recOpts.status);
  const initial = recOpts.name ? recOpts.name[0] : '?';
  const layout = computeLayout(ctx, recOpts.messages, chatRect, recOpts.anchor || 'bottom');
  const stagger = recOpts.stagger ?? ANIM.stagger;
  const appearDur = recOpts.appearDur ?? ANIM.appearDur;
  const typingLead = Math.min(TYPING.maxLead, stagger);
  return function drawAt(t) {
    ctx.clearRect(0, 0, VW, VH);
    ctx.drawImage(chrome, 0, 0, VW, VH);
    layout.forEach((m, i) => {
      const appearAt = i * stagger;
      if (t >= appearAt) {
        const p = Math.min(1, (t - appearAt) / appearDur);
        ctx.save();
        ctx.globalAlpha = p;
        ctx.translate(0, (1 - p) * ANIM.rise);
        drawBubble(ctx, m.side, m.text, m.top, chatRect, initial);
        ctx.restore();
      } else if (m.side === 'L' && t >= appearAt - typingLead) {
        const tp = Math.min(1, (t - (appearAt - typingLead)) / appearDur);
        ctx.save();
        ctx.globalAlpha = tp;
        drawTyping(ctx, m.top, m.h, chatRect, initial);
        ctx.restore();
      }
    });
  };
}

function recordVideo(opts, { fps = 30, format = 'mp4', onProgress } = {}) {
  const { canvas, ctx } = setupCanvas();
  const recOpts = Object.assign({ bg: '#ffffff' }, opts);
  const { mime, ext } = pickVideoMime(format);
  // captureStream(0) = 手動フレーム供給。requestFrame() で1枚ずつ送るので
  // requestAnimationFrame が止まる環境（非アクティブタブ）でも録画が継続する。
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream,
    mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : { videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const drawAt = buildSlideRenderer(ctx, recOpts);
  const total = totalDuration(recOpts);
  const frameMs = 1000 / fps;
  const nFrames = Math.max(1, Math.ceil(total / frameMs));
  return new Promise((resolve, reject) => {
    rec.onstop = () => resolve({ blob: new Blob(chunks, { type: mime || 'video/webm' }), ext });
    rec.onerror = e => reject(e.error || new Error('record error'));
    rec.start();
    let n = 0;
    const start = performance.now();
    // フレーム番号で t を刻みつつ、次フレームは実時刻に合わせて待つ
    //（全フレームを必ず描画＆送出しながら、再生速度を実時間に一致させる）。
    (function tick() {
      drawAt(Math.min(total, n * frameMs));
      if (track && track.requestFrame) track.requestFrame();
      else if (stream.requestFrame) stream.requestFrame();
      if (onProgress) onProgress(n / nFrames);
      n++;
      if (n <= nFrames) {
        const delay = Math.max(0, start + n * frameMs - performance.now());
        setTimeout(tick, delay);
      } else {
        setTimeout(() => rec.stop(), 120); // 最終フレームを確実に取り込む
      }
    })();
  });
}

/* ===========================================================================
 * Phase 5: GIF 書き出し（gif.js）。各フレームを集めてエンコード。
 *   GIF は等倍(VW×VH)に縮小してファイルサイズを抑える。
 *   返り値: Promise<{ blob, ext:'gif' }>。onProgress(0..1)。
 * =========================================================================== */
function recordGif(opts, { fps = 15, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof GIF === 'undefined') { reject(new Error('gif.js が読み込まれていません')); return; }
    if (location.protocol === 'file:') {
      reject(new Error('GIFはファイル直開き(file://)では作れません。http:// で開いてください（MP4/WebMはそのまま使えます）。'));
      return;
    }
    const { canvas, ctx } = setupCanvas();
    const recOpts = Object.assign({ bg: '#ffffff' }, opts);
    const drawAt = buildSlideRenderer(ctx, recOpts);
    const total = totalDuration(recOpts);
    const frameMs = 1000 / fps;
    const nFrames = Math.max(1, Math.ceil(total / frameMs));
    // GIFは等倍に縮小（720×1280 → 360×640）してサイズを抑える
    const gcanvas = document.createElement('canvas');
    gcanvas.width = VW; gcanvas.height = VH;
    const gctx = gcanvas.getContext('2d');
    const gif = new GIF({ workers: 2, quality: 10, width: VW, height: VH, workerScript: 'gif.worker.js' });
    for (let n = 0; n <= nFrames; n++) {
      drawAt(Math.min(total, n * frameMs));
      gctx.clearRect(0, 0, VW, VH);
      gctx.drawImage(canvas, 0, 0, VW, VH);
      gif.addFrame(gctx, { copy: true, delay: frameMs });
      if (onProgress) onProgress((n / nFrames) * 0.5); // 前半: フレーム収集
    }
    gif.on('progress', p => { if (onProgress) onProgress(0.5 + p * 0.5); }); // 後半: エンコード
    gif.on('finished', blob => resolve({ blob, ext: 'gif' }));
    gif.on('abort', () => reject(new Error('GIF生成が中断されました')));
    gif.render();
  });
}

/* 描画・録画関数（drawSlide / playSlide / renderFrame / recordVideo 等）はグローバル。
 * index.html の書き出しUIから呼び出す。 */
