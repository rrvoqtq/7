import ballImage from './d.png?url';

$(() => {
  // =========================================================
  // 1) 参考 “全息悬浮终端” 的全局配置：球体尺寸、边距、层级、宿主节点
  //    这里保留了原脚本的强隔离、Shadow DOM 方式，确保它不会干扰酒馆原有页面。
  // =========================================================
  const WIDGET_ID = 'st-hologram-ball-container';
  const CONFIG = {
    SAFE_MARGIN: 15,
    BALL_SIZE: 64,
    PANEL_WIDTH: 360,
    PANEL_HEIGHT: 620,
    Z_INDEX: 999999,
    DEFAULT_IMAGE: ballImage,
  };

  // 悬浮球弹出气泡的 emoji 池（水果/食物）
  const EMOJIS = ['🍇','🍈','🍉','🍊','🍋','🍌','🍍','🥭','🍎','🍏','🍐','🍑','🍒','🍓','🫐','🥝','🍅','🥥','🥑','🍆','🥔','🥕','🌽','🌶️','🫑','🥒','🥬','🥦','🧄','🧅','🥜','🌰','🍞','🥐','🥖','🥨','🥯','🥞','🧇','🧀','🍖','🍗','🥩','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🥙','🥚','🍳','🥘','🍲','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🍡','🍱','🍘','🍙','🍚','🍨','🍦','🍧','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍼','🥛','☕','🍵','🧋','🍶','🍷','🍸','🍹','🍺','🍻','🥂'];

  // =========================================================
  // 2.1) emoji 弹出配置：内容、间隔时间、气泡持续时间，支持导入导出
  //      默认配置为内建的 EMOJIS，可导出作为默认模板。
  // =========================================================
  const EMOJI_CONFIG_KEY = 'ta_emoji_config';
  let activeEmojis: string[] = EMOJIS;
  let emojiIntervalSec = 60;
  let emojiDurationMs = 2000;
  try {
    const savedEmojiCfg = localStorage.getItem(EMOJI_CONFIG_KEY);
    if (savedEmojiCfg) {
      const cfg = JSON.parse(savedEmojiCfg);
      if (Array.isArray(cfg.contents) && cfg.contents.length > 0) activeEmojis = cfg.contents;
      if (typeof cfg.interval === 'number' && cfg.interval > 0) emojiIntervalSec = cfg.interval;
      if (typeof cfg.duration === 'number' && cfg.duration > 0) emojiDurationMs = cfg.duration;
    }
  } catch (e) {
    // 配置损坏则用默认值
  }

  let targetWindow = window;
  let targetDocument = document;
  try {
    if (window.parent && window.parent.document) {
      targetWindow = window.parent;
      targetDocument = window.parent.document;
    }
  } catch (error) {
    console.warn('[悬浮窗测试] 跨域沙盒捕获失败，使用当前页面节点');
  }

  // =========================================================
  // 1.5) 读取酒馆 (SillyTavern) 主题变量，让悬浮窗 UI 跟随酒馆配色
  // =========================================================
  const rootStyle = targetWindow.getComputedStyle(targetDocument.documentElement);
  const theme = {
    bodyColor: rootStyle.getPropertyValue('--SmartThemeBodyColor').trim() || 'rgba(220, 220, 210, 1)',
    emColor: rootStyle.getPropertyValue('--SmartThemeEmColor').trim() || 'rgba(145, 145, 145, 1)',
    blurTint: rootStyle.getPropertyValue('--SmartThemeBlurTintColor').trim() || 'rgba(23, 23, 23, 1)',
    underline: rootStyle.getPropertyValue('--SmartThemeUnderlineColor').trim() || 'rgba(188, 231, 207, 1)',
    quote: rootStyle.getPropertyValue('--SmartThemeQuoteColor').trim() || 'rgba(225, 138, 36, 1)',
    userMesBg: rootStyle.getPropertyValue('--SmartThemeUserMesBlurTintColor').trim() || 'rgba(30, 30, 30, 0.9)',
    botMesBg: rootStyle.getPropertyValue('--SmartThemeBotMesBlurTintColor').trim() || 'rgba(30, 30, 30, 0.9)',
  };
  function withAlpha(cssColor: string, alpha: number): string {
    const m = cssColor.match(/rgba?\(([^)]+)\)/);
    if (!m) return cssColor;
    const parts = m[1].split(',').map(s => s.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  function withMixed(cssColor: string, mixColor: string, ratio: number): string {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [128, 128, 128];
      const parts = m[1].split(',').map(s => parseFloat(s.trim()));
      return [parts[0], parts[1], parts[2]];
    };
    const a = parse(cssColor);
    const b = parse(mixColor);
    // cssColor（主题色）占主导，(1-ratio) 为主色占比；mixColor 仅占 ratio 微调
    const r = Math.round(a[0] * (1 - ratio) + b[0] * ratio);
    const g = Math.round(a[1] * (1 - ratio) + b[1] * ratio);
    const bl = Math.round(a[2] * (1 - ratio) + b[2] * ratio);
    return `rgb(${r}, ${g}, ${bl})`;
  }
  function colorLuminance(cssColor: string): number {
    const m = cssColor.match(/rgba?\(([^)]+)\)/);
    if (!m) return 128;
    const parts = m[1].split(',').map(s => parseFloat(s.trim()));
    return 0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2];
  }

  // =========================================================
  // 1.6) 动态主题同步：读取酒馆 CSS 变量，设置到 shadow root，
  //      并用 MutationObserver 监听酒馆主题切换，实时更新。
  // =========================================================
  function readThemeVars() {
    const cs = targetWindow.getComputedStyle(targetDocument.documentElement);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    theme.bodyColor = v('--SmartThemeBodyColor', theme.bodyColor);
    theme.emColor = v('--SmartThemeEmColor', theme.emColor);
    theme.blurTint = v('--SmartThemeBlurTintColor', theme.blurTint);
    theme.underline = v('--SmartThemeUnderlineColor', theme.underline);
    theme.quote = v('--SmartThemeQuoteColor', theme.quote);
    theme.userMesBg = v('--SmartThemeUserMesBlurTintColor', theme.userMesBg);
    theme.botMesBg = v('--SmartThemeBotMesBlurTintColor', theme.botMesBg);
  }

  function syncThemeToShadow(sr: ShadowRoot) {
    readThemeVars();
    const h = sr.host as HTMLElement;
    const prop = (n: string, v: string) => h.style.setProperty(n, v, 'important');

    // 读取酒馆 body 的背景图（若有），让悬浮窗页面跟随主题背景图
    const bodyCs = targetWindow.getComputedStyle(targetDocument.body);
    const bodyBgImage = bodyCs.backgroundImage && bodyCs.backgroundImage !== 'none'
      ? bodyCs.backgroundImage
      : '';

    // 页面背景：跟随主题色（blurTint 主导 + 白色微调），任意主题下自然协调
    function buildPageBackground(): string {
      const tintBg = withMixed(theme.blurTint, 'rgb(255, 255, 255)', 0.08);
      if (bodyBgImage) {
        // 半透明遮罩 + 主题背景图/渐变 + 主题底色，图片适当显示且保证文字可读
        return `linear-gradient(rgba(0, 0, 0, 0.25), rgba(0, 0, 0, 0.25)) center / cover, ${bodyBgImage} center / cover, ${tintBg}`;
      }
      return tintBg;
    }
    const pageBackground = buildPageBackground();

    // 主题虚线边框：模仿酒馆美化主题用虚线分隔各部分，颜色跟随主题
    const uiBorderColor = withAlpha(theme.underline, 0.55);
    const uiBorderSoft = withAlpha(theme.underline, 0.18);

    prop('--primary', theme.bodyColor);
    prop('--text-color', theme.bodyColor);
    prop('--text-muted', theme.emColor);
    prop('--bg-panel', withAlpha(theme.blurTint, 0.88));
    prop('--bg-panel-strong', withAlpha(theme.blurTint, 0.95));
    prop('--green', theme.underline);
    prop('--green-soft', withAlpha(theme.underline, 0.18));
    prop('--user-msg-bg', theme.userMesBg);
    prop('--bot-msg-bg', theme.botMesBg);
    const font = targetWindow.getComputedStyle(targetDocument.documentElement)
      .getPropertyValue('--mainFontFamily').trim() || '"Noto Sans", sans-serif';
    prop('--font-family', font);

    // ---- 派生主题变量（跟随酒馆主题实时更新） ----
    prop('--page-bg', pageBackground);
    prop('--desktop-bg', pageBackground);
    prop('--chat-bg', pageBackground);
    prop('--screen-bg', `linear-gradient(180deg, ${withMixed(theme.blurTint, 'rgb(255, 255, 255)', 0.07)}, ${withMixed(theme.blurTint, 'rgb(255, 255, 255)', 0.12)})`);
    prop('--header-bg', withMixed(theme.blurTint, 'rgb(255, 255, 255)', 0.07));
    prop('--input-bg', withMixed(theme.blurTint, 'rgb(255, 255, 255)', 0.12));
    prop('--input-border', uiBorderColor);
    prop('--shell-bg', withAlpha(theme.blurTint, 0.72));
    prop('--shell-border', uiBorderColor);
    prop('--status-bg', withMixed(theme.blurTint, 'rgb(255, 255, 255)', 0.05));
    prop('--status-border', uiBorderColor);
    prop('--ui-border', `2px solid ${uiBorderColor}`);
    prop('--ui-border-soft', `2px solid ${uiBorderSoft}`);
    prop('--btn-primary-bg',
      `linear-gradient(180deg, ${withMixed(theme.underline, 'rgb(255, 255, 255)', 0.18)}, ${theme.underline})`);
    // 按钮文字颜色：主题按钮色较亮时用深色字，较暗时用浅色字，保证对比度且跟随主题
    prop('--btn-text', colorLuminance(theme.underline) > 160 ? 'rgba(30, 30, 30, 0.9)' : 'rgba(255, 255, 255, 0.95)');
    prop('--icon-chat-bg',
      `linear-gradient(180deg, ${withMixed(theme.underline, 'rgb(255, 255, 255)', 0.18)}, ${theme.underline})`);
    prop('--icon-setting-bg',
      `linear-gradient(180deg, ${theme.emColor}, ${withMixed(theme.emColor, 'rgb(0, 0, 0)', 0.3)})`);
    prop('--modal-bg', withAlpha(theme.blurTint, 0.97));
    prop('--ghost-bg', withAlpha(theme.emColor, 0.28));
    prop('--ghost-color', theme.bodyColor);
    prop('--button-shadow', `0 6px 12px ${withAlpha(theme.underline, 0.25)}`);
    prop('--border-glass', withAlpha(theme.emColor, 0.22));
  }

  let _themeObserver: MutationObserver | null = null;
  let _themePollTimer: number | null = null;
  let _lastThemeSignature = '';
  function startThemeObserver(sr: ShadowRoot) {
    _themeObserver?.disconnect();
    if (_themePollTimer !== null) {
      targetWindow.clearInterval(_themePollTimer);
      _themePollTimer = null;
    }
    const sync = () => {
      readThemeVars();
      const signature = `${theme.bodyColor}|${theme.emColor}|${theme.blurTint}|${theme.underline}|${theme.userMesBg}|${theme.botMesBg}`;
      if (signature !== _lastThemeSignature) {
        _lastThemeSignature = signature;
        syncThemeToShadow(sr);
      }
    };
    _themeObserver = new MutationObserver(sync);
    _themeObserver.observe(targetDocument.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    _themeObserver.observe(targetDocument.body, { attributes: true, attributeFilter: ['class', 'style'] });
    // 兜底轮询：酒馆切换主题可能只改 <style> 标签内容而不改 class/style 属性
    _themePollTimer = targetWindow.setInterval(sync, 3000);
    sync();
  }

  // 如果已经存在同名节点，先清掉，避免重复挂载。
  const existNode = targetDocument.getElementById(WIDGET_ID);
  if (existNode) existNode.remove();

  // 宿主容器：通过 Shadow DOM 隔离样式，和全息悬浮终端保持一致。
  const holder = targetDocument.createElement('div');
  holder.id = WIDGET_ID;
  holder.style.position = 'fixed';
  holder.style.top = '0';
  holder.style.left = '0';
  holder.style.width = '0';
  holder.style.height = '0';
  holder.style.overflow = 'visible';
  holder.style.pointerEvents = 'none';
  holder.style.zIndex = String(CONFIG.Z_INDEX);
  targetDocument.body.appendChild(holder);

  const shadow = holder.attachShadow({ mode: 'open' });
  syncThemeToShadow(shadow);
  startThemeObserver(shadow);

  // =========================================================
  // 2) 参考 “全息悬浮终端” 的样式：极简黑底 + 白光发光 + 毛玻璃面板
  //    目的：让悬浮球和展开后的面板和参考脚本视觉一致。
  // =========================================================
  const style = targetDocument.createElement('style');
  style.textContent = `
    :host {
      --primary: ${theme.bodyColor};
      --em: ${theme.emColor};
      --glow-color: ${theme.underline};
      --bg-panel: ${withAlpha(theme.blurTint, 0.88)};
      --bg-panel-strong: ${withAlpha(theme.blurTint, 0.95)};
      --text-color: ${theme.bodyColor};
      --text-muted: ${theme.emColor};
      --border-glass: ${withAlpha(theme.emColor, 0.22)};
      --transition-base: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      --green: ${theme.underline};
      --green-soft: ${withAlpha(theme.underline, 0.18)};
      all: initial;
    }

    * {
      box-sizing: border-box;
      font-family: var(--font-family, inherit);
    }

    .force-hide {
      display: none !important;
    }

    .float-ball {
      position: absolute;
      width: ${CONFIG.BALL_SIZE}px;
      height: ${CONFIG.BALL_SIZE}px;
      left: 0;
      top: 0;
      background-image: url('${CONFIG.DEFAULT_IMAGE}');
      background-size: auto 150%;
      background-repeat: no-repeat;
      background-position: center;
      border-radius: 50%;
      cursor: grab;
      pointer-events: auto;
      user-select: none;
      transition: transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
    }

    .float-ball:hover {
      transform: scale(1.08);
    }

    .float-ball:active {
      cursor: grabbing;
      transform: scale(0.95);
    }

    .float-ball.dragging {
      transition: none;
    }

    /* 播放音乐时悬浮球上下浮动 */
    .float-ball.beat {
      animation: beat-bounce 0.4s ease-out;
    }

    @keyframes beat-bounce {
      0% { transform: translateY(0) scale(1); }
      30% { transform: translateY(-14px) scale(1.08); }
      60% { transform: translateY(2px) scale(1.03); }
      100% { transform: translateY(0) scale(1); }
    }

    .float-ball.hidden {
      transform: scale(0);
      opacity: 0;
      pointer-events: none;
    }

    .emoji-pop {
      position: absolute;
      left: 0;
      top: 0;
      background: var(--bg-panel);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 2px solid var(--status-border);
      border-radius: 10px;
      padding: 6px 8px;
      font-size: 13px;
      line-height: 1;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
      pointer-events: none;
      opacity: 0;
      transform: translate(-50%, 0) scale(0.5);
      animation: emoji-rise 2s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
      z-index: 999;
    }

    @keyframes emoji-rise {
      0% {
        opacity: 0;
        transform: translate(-50%, 0) scale(0.5);
      }
      20% {
        opacity: 1;
        transform: translate(-50%, -18px) scale(1.05);
      }
      60% {
        opacity: 1;
        transform: translate(-50%, -46px) scale(1);
      }
      100% {
        opacity: 0;
        transform: translate(-50%, -76px) scale(0.9);
      }
    }

    /* 歌词条：位于悬浮球下方，半透明无箭头，开会面板时会有一部分被覆盖 */
    .lyric-bubble {
      position: absolute;
      max-width: 300px;
      min-width: 120px;
      background: var(--bg-panel);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 2px solid var(--status-border);
      border-radius: 12px;
      padding: 6px 12px;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s ease;
      z-index: 10;
      text-align: center;
      overflow: hidden;
      white-space: nowrap;
    }

    .lyric-bubble.show {
      opacity: 1;
    }

    .lyric-bubble .lyric-scroll {
      display: inline-block;
      white-space: nowrap;
      color: var(--text-color);
      font-size: 13px;
      line-height: 1.4;
    }

    .control-panel {
      position: absolute;
      width: ${CONFIG.PANEL_WIDTH}px;
      height: ${CONFIG.PANEL_HEIGHT}px;
      left: 0;
      top: 0;
      min-width: 280px;
      min-height: 380px;
      max-width: 90vw;
      max-height: 90vh;
      resize: both;
      background: var(--bg-panel);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 2px solid var(--border-glass);
      border-radius: 14px;
      box-shadow: 0 18px 38px rgba(0, 0, 0, 0.6), 0 0 18px rgba(255, 255, 255, 0.06);
      display: flex;
      flex-direction: column;
      opacity: 0;
      transform: scale(0.9) translateY(15px);
      pointer-events: none;
      transition: var(--transition-base);
      overflow: hidden;
      z-index: 99;
    }

    .control-panel::-webkit-resizer {
      background: linear-gradient(135deg, transparent 45%, var(--green) 46%, var(--green) 55%, transparent 56%);
      background-size: 12px 12px;
      border-bottom-right-radius: 14px;
    }

    .control-panel.show {
      opacity: 1;
      transform: scale(1) translateY(0);
      pointer-events: auto;
    }

    .panel-header {
      height: 26px;
      background: transparent;
      border-bottom: 2px solid var(--status-border);
      display: flex;
      justify-content: flex-start;
      align-items: center;
      padding: 0 10px;
      color: var(--text-color);
      cursor: move;
      font-size: 14px;
      font-weight: 500;
      letter-spacing: 0.5px;
      user-select: none;
      flex-shrink: 0;
    }

    .panel-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-color);
    }

    .close-btn {
      position: absolute;
      right: 10px;
      bottom: 10px;
      z-index: 60;
      cursor: pointer;
      color: var(--text-muted);
      transition: var(--transition-base);
      padding: 6px;
      font-size: 20px;
      line-height: 1;
      transform: rotate(0deg);
      background: var(--bg-panel);
      border: 2px solid var(--shell-border);
      border-radius: 50%;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
    }

    .close-btn:hover,
    .close-btn:active {
      color: var(--green);
      transform: rotate(90deg);
    }

    .panel-body {
      flex: 1;
      padding: 14px;
      background: var(--bg-panel-strong);
      display: flex;
      justify-content: center;
      align-items: center;
      color: var(--text-color);
    }

    .device-shell {
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 12px;
      background: var(--shell-bg);
      border: 2px solid var(--shell-border);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04), 0 0 20px rgba(255,255,255,0.04);
      overflow: hidden;
    }

    .device-status {
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      font-size: 12px;
      color: var(--text-muted);
      background: var(--status-bg);
      border-bottom: 2px solid var(--status-border);
    }

    #deviceTime {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-color);
      letter-spacing: 1px;
    }

    #deviceMeta {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .device-screen {
      position: relative;
      height: calc(100% - 42px);
      background: var(--screen-bg);
    }

    .page {
      position: absolute;
      inset: 0;
      display: none;
      background: var(--page-bg);
    }

    .page.active {
      display: block;
    }

    .desktop-page {
      padding: 24px 16px;
      background: var(--chat-bg);
    }

    .app-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
      padding-top: 12px;
    }

    .app-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      color: var(--text-color);
      text-align: center;
    }

    .app-icon {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      border: 2px solid var(--status-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      box-shadow: 0 6px 16px rgba(255, 255, 255, 0.16);
    }

    .chat-icon {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.32), rgba(255, 255, 255, 0.12));
      color: var(--text-color);
    }

    .setting-icon {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.32), rgba(255, 255, 255, 0.12));
      color: var(--text-color);
    }

    .regex-icon {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.32), rgba(255, 255, 255, 0.12));
      color: var(--text-color);
    }

    .aquarium-icon {
      position: relative;
      background: transparent;
      border: 0;
      box-shadow: none;
      overflow: hidden;
    }

    /* 半透明玻璃方框：叠在 🏝️ 和 🐢 之上，不裁剪超出部分 */
    .aquarium-icon::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.15);
      border: 2px solid rgba(255, 255, 255, 0.35);
      box-shadow: inset 0 0 10px rgba(255, 255, 255, 0.12);
      z-index: 3;
      pointer-events: none;
    }

    .aq-island {
      position: absolute;
      left: 50%;
      bottom: 4px;
      transform: translateX(-50%);
      font-size: 45px;
      line-height: 1;
      z-index: 1;
    }

    .aq-turtle {
      position: absolute;
      left: 50%;
      bottom: 8px;
      transform: translateX(-50%);
      font-size: 20px;
      line-height: 1;
      z-index: 2;
    }

    .app-name {
      font-size: 12px;
      margin-top: 8px;
      line-height: 1.2;
    }

    .chat-page.active {
      display: flex;
      flex-direction: column;
      background: var(--chat-bg);
    }

    .chat-header {
      height: 48px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      background: var(--header-bg);
      border-bottom: 2px solid var(--status-border);
      color: var(--text-color);
    }

    .back-btn {
      cursor: pointer;
      font-size: 18px;
      color: var(--green);
      margin-right: 12px;
      user-select: none;
    }

    .chat-title {
      font-weight: 500;
      font-size: 15px;
      flex: 1;
    }

    .chat-header-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .chat-message-wrap {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      background: var(--chat-bg);
    }

    .msg-item {
      display: flex;
      margin: 8px 0;
    }

    .msg-item.user {
      justify-content: flex-end;
    }

    .msg-item.ai {
      justify-content: flex-start;
    }

    .msg-bubble {
      max-width: 72%;
      padding: 8px 12px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .msg-item.ai .msg-bubble {
      background: var(--bot-msg-bg, rgba(255,255,255,0.9));
      color: var(--text-color, #1f1f1f);
      border: 2px solid var(--status-border);
    }

    .msg-item.user .msg-bubble {
      background: var(--user-msg-bg, #95ec69);
      color: var(--text-color, #122117);
      border: 2px solid var(--status-border);
    }

    .chat-input-bar {
      display: flex;
      gap: 6px;
      padding: 8px;
      background: var(--header-bg);
      border-top: 2px solid var(--status-border);
    }

    .chat-input {
      flex: 1;
      min-height: 40px;
      border: 2px solid var(--input-border);
      border-radius: 8px;
      padding: 8px 10px;
      resize: none;
      font: inherit;
      background: var(--input-bg);
      color: var(--text-color);
    }

    .chat-input::placeholder {
      color: var(--text-muted);
      opacity: 0.7;
    }

    .send-btn {
      background: var(--btn-primary-bg);
      color: var(--btn-text);
      border: 2px solid var(--status-border);
      border-radius: 8px;
      padding: 0 14px;
      cursor: pointer;
      font-size: 13px;
      box-shadow: var(--button-shadow);
    }

    .regex-page.active {
      display: flex;
      flex-direction: column;
      background: var(--chat-bg);
    }

    .regex-rules {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .regex-rule {
      background: var(--input-bg);
      border: 2px solid var(--input-border);
      border-radius: 8px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .regex-rule input[type="text"],
    .regex-rule textarea {
      width: 100%;
      border: 2px solid var(--input-border);
      border-radius: 6px;
      padding: 6px 8px;
      background: var(--input-bg);
      color: var(--text-color);
      font: inherit;
      font-size: 12px;
    }

    .regex-rule textarea {
      resize: vertical;
      min-height: 38px;
    }

    .regex-rule-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .regex-rule-row label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--text-muted);
      cursor: pointer;
    }

    .regex-del {
      background: var(--ghost-bg);
      color: var(--ghost-color);
      border: 0;
      border-radius: 6px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 12px;
    }

    .regex-del:hover {
      color: #ff5252;
    }

    .regex-actions {
      display: flex;
      gap: 8px;
      padding: 8px 10px;
      background: var(--header-bg);
      border-top: 2px solid var(--status-border);
    }

    .regex-actions .ghost-btn,
    .regex-actions .primary-btn {
      flex: 1;
    }

    .regex-tip {
      font-size: 11px;
      color: var(--text-muted);
      padding: 0 4px;
      line-height: 1.4;
    }

    .regex-empty {
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
      padding: 24px 0;
    }

    .music-page.active {
      display: flex;
      flex-direction: column;
      background: var(--chat-bg);
    }

    .music-search-bar {
      display: flex;
      gap: 6px;
      padding: 8px 10px;
      background: var(--header-bg);
      border-bottom: 2px solid var(--status-border);
    }

    /* 独立搜索弹窗：小于主页面，被方框包裹，显示在主页面之上 */
    .music-search-overlay {
      position: absolute;
      left: 10px;
      right: 10px;
      top: 52px;
      bottom: 118px;
      z-index: 40;
      background: var(--bg-panel-strong);
      border: 2px solid var(--status-border);
      border-radius: 12px;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .music-search-results {
      flex: 1;
      overflow-y: auto;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .music-search-result-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: 2px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text-color);
      transition: var(--transition-base);
    }

    .music-search-result-item:hover {
      border: 2px solid var(--status-border);
      background: var(--input-bg);
    }

    .music-search-result-item.loading {
      opacity: 0.55;
      pointer-events: none;
    }

    .music-search-input {
      flex: 1;
      border: 2px solid var(--status-border);
      border-radius: 8px;
      padding: 6px 10px;
      background: var(--input-bg);
      color: var(--text-color);
      font: inherit;
      font-size: 12px;
    }

    .music-search-input::placeholder {
      color: var(--text-muted);
      opacity: 0.7;
    }

    .music-playlist-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--header-bg);
      border-bottom: 2px solid var(--status-border);
    }

    .music-playlists {
      flex: 1;
      display: flex;
      gap: 6px;
      overflow-x: auto;
      white-space: nowrap;
      scrollbar-width: none;
    }

    .music-playlists::-webkit-scrollbar {
      display: none;
    }

    .music-playlist-chip {
      flex-shrink: 0;
      padding: 4px 10px;
      border: 2px solid var(--status-border);
      border-radius: 14px;
      font-size: 12px;
      color: var(--text-color);
      cursor: pointer;
      background: var(--input-bg);
      transition: var(--transition-base);
    }

    .music-playlist-chip:hover {
      background: var(--green-soft);
    }

    .music-playlist-chip.active {
      background: var(--btn-primary-bg);
      color: var(--btn-text);
      border-color: var(--status-border);
    }

    .music-new-playlist {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      border: 2px solid var(--status-border);
      border-radius: 50%;
      background: var(--input-bg);
      color: var(--text-color);
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: var(--transition-base);
    }

    .music-new-playlist:hover {
      background: var(--green-soft);
    }

    .music-delete-playlist {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      border: 2px solid var(--status-border);
      border-radius: 50%;
      background: var(--input-bg);
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: var(--transition-base);
    }

    .music-delete-playlist:hover {
      color: #ff5252;
      border-color: #ff5252;
    }

    .music-new-playlist-form {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: var(--header-bg);
      border-bottom: 2px solid var(--status-border);
    }

    .music-add-playlist-form {
      padding: 8px 10px;
      background: var(--header-bg);
      border-bottom: 2px solid var(--status-border);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .music-add-playlist-title {
      font-size: 12px;
      color: var(--text-muted);
      text-align: center;
    }

    .music-add-playlist-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .music-add-playlist-option {
      flex: 1 1 auto;
      padding: 6px 12px;
      border: 2px solid var(--status-border);
      border-radius: 14px;
      font-size: 12px;
      color: var(--text-color);
      cursor: pointer;
      background: var(--input-bg);
      text-align: center;
      transition: var(--transition-base);
    }

    .music-add-playlist-option:hover {
      background: var(--green-soft);
    }

    .music-add-playlist-empty {
      font-size: 12px;
      color: var(--text-muted);
      text-align: center;
      padding: 4px 0;
    }

    .music-add-playlist-actions {
      display: flex;
      justify-content: center;
      gap: 10px;
    }

    .music-item-add {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      border: 2px solid var(--status-border);
      border-radius: 50%;
      background: var(--input-bg);
      color: var(--text-color);
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: var(--transition-base);
    }

    .music-item-add:hover {
      background: var(--green-soft);
      color: var(--green);
    }

    .music-item-remove {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      border: 2px solid var(--status-border);
      border-radius: 50%;
      background: var(--input-bg);
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: var(--transition-base);
    }

    .music-item-remove:hover {
      color: #ff5252;
      border-color: #ff5252;
    }

    .music-list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .music-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: 2px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text-color);
      transition: var(--transition-base);
    }

    .music-item:hover {
      border: 2px solid var(--status-border);
      background: var(--input-bg);
    }

    .music-item.active {
      border: 2px solid var(--status-border);
      background: var(--green-soft);
    }

    .music-item-index {
      width: 24px;
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
      flex-shrink: 0;
    }

    .music-item-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .music-item-name {
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .music-item-artist {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .music-player {
      border-top: 2px solid var(--status-border);
      background: var(--header-bg);
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }

    .music-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .music-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .music-artist {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .music-progress {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .music-time {
      font-size: 11px;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .music-range {
      flex: 1;
      accent-color: var(--green);
      height: 4px;
      cursor: pointer;
    }

    .music-controls {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 20px;
    }

    .music-btn {
      background: var(--input-bg);
      color: var(--text-color);
      border: 2px solid var(--status-border);
      border-radius: 50%;
      width: 34px;
      height: 34px;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: var(--transition-base);
    }

    .music-btn:hover {
      background: var(--green-soft);
    }

    .music-play {
      width: 44px;
      height: 44px;
      font-size: 18px;
      background: var(--btn-primary-bg);
      color: var(--btn-text);
      border: 2px solid var(--status-border);
    }

    .music-volume {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .music-vol-icon {
      font-size: 13px;
    }

    .music-lyric {
      max-height: 80px;
      overflow-y: auto;
      text-align: center;
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.6;
      padding: 4px 0;
      border-top: 1px dashed var(--status-border);
    }

    .music-queue-toggle {
      padding: 4px 8px;
      font-size: 12px;
      color: var(--text-muted);
      cursor: pointer;
      border-top: 2px solid var(--status-border);
      text-align: center;
      transition: var(--transition-base);
    }

    .music-queue-toggle:hover {
      color: var(--green);
      background: var(--green-soft);
    }

    .music-recommend-panel {
      position: absolute;
      inset: 14px;
      z-index: 30;
      background: var(--bg-panel-strong);
      border: 2px solid var(--status-border);
      border-radius: 14px;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      animation: recommend-pulse 1.2s ease-in-out infinite;
    }

    @keyframes recommend-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }

    .music-recommend-panel.done {
      animation: none;
    }

    .music-recommend-status {
      font-size: 13px;
      color: var(--text-color);
    }

    .music-recommend-song {
      font-size: 26px;
      font-weight: 700;
      color: var(--green);
      text-align: center;
      line-height: 1.3;
      word-break: break-word;
    }

    .music-recommend-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }

    .music-recommend-loading {
      width: 22px;
      height: 22px;
      border: 3px solid var(--status-border);
      border-top-color: var(--green);
      border-radius: 50%;
      animation: recommend-spin 0.8s linear infinite;
    }

    @keyframes recommend-spin {
      to { transform: rotate(360deg); }
    }

    .music-queue {
      position: absolute;
      left: 6px;
      right: 6px;
      bottom: 220px;
      max-height: 160px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 6px;
      background: var(--bg-panel-strong);
      border: 2px solid var(--status-border);
      border-radius: 10px;
      z-index: 20;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
    }

    .music-queue-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      color: var(--text-color);
      transition: var(--transition-base);
    }

    .music-queue-item:hover {
      background: var(--input-bg);
    }

    .music-queue-item.active {
      background: var(--green-soft);
      color: var(--green);
    }

    .music-queue-index {
      width: 20px;
      text-align: center;
      color: var(--text-muted);
      font-size: 11px;
      flex-shrink: 0;
    }

    .music-queue-name {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .music-queue-artist {
      color: var(--text-muted);
      font-size: 11px;
      max-width: 90px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 0;
    }

    .modal {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.5);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }

    .modal.show {
      display: flex;
    }

    .modal-content {
      background: var(--modal-bg);
      color: var(--text-color);
      border: 2px solid var(--status-border);
      border-radius: 12px;
      width: 88%;
      max-width: 310px;
      padding: 18px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 18px 32px rgba(0,0,0,0.25);
    }

    .modal-content h3 {
      margin: 0;
      font-size: 18px;
      color: var(--text-color);
    }

    .setting-menu {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .setting-menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 12px 12px;
      border: 2px solid var(--status-border);
      border-radius: 10px;
      background: var(--input-bg);
      color: var(--text-color);
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      text-align: left;
      transition: var(--transition-base);
    }

    .setting-menu-item:hover {
      background: var(--green-soft);
      border-color: var(--green);
    }

    .setting-menu-icon {
      font-size: 18px;
      flex-shrink: 0;
    }

    .setting-menu-arrow {
      margin-left: auto;
      color: var(--text-muted);
      font-size: 22px;
    }

    .setting-toggle-row {
      justify-content: space-between;
      cursor: default;
    }

    /* 悬浮球动画开关 */
    .switch {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
      flex-shrink: 0;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .switch .slider {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background: var(--text-muted);
      border-radius: 24px;
      transition: var(--transition-base);
    }

    .switch .slider::before {
      content: '';
      position: absolute;
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background: #fff;
      border-radius: 50%;
      transition: var(--transition-base);
    }

    .switch input:checked + .slider {
      background: var(--green);
    }

    .switch input:checked + .slider::before {
      transform: translateX(20px);
    }

    .setting-footer {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-top: 4px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .field input,
    .field select {
      width: 100%;
      border: 2px solid var(--input-border);
      border-radius: 7px;
      padding: 8px 10px;
      background: var(--input-bg);
      color: var(--text-color);
      font: inherit;
    }

    .field-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .field-row select {
      flex: 1;
    }

    .action-row {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
    }

    .ghost-btn,
    .primary-btn {
      border: 2px solid var(--status-border);
      border-radius: 7px;
      cursor: pointer;
      padding: 8px 12px;
      font-size: 13px;
    }

    .ghost-btn {
      background: var(--ghost-bg);
      color: var(--ghost-color);
    }

    .primary-btn {
      background: var(--btn-primary-bg);
      color: var(--btn-text);
    }

    @media (max-width: 420px) {
      .app-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `;
  shadow.appendChild(style);

  // =========================================================
  // 3) 参考 “全息悬浮终端” 的球体和面板 DOM 结构。
  //    这里还混入了新文件22 的桌面、聊天页和设置表单的功能区域。
  // =========================================================
  const ball = targetDocument.createElement('div');
  ball.className = 'float-ball';
  // 初始居中显示（水平和垂直都居中）
  ball.style.left = `${Math.round((targetWindow.innerWidth - CONFIG.BALL_SIZE) / 2)}px`;
  ball.style.top = `${Math.round((targetWindow.innerHeight - CONFIG.BALL_SIZE) / 2)}px`;
  shadow.appendChild(ball);

  // 播放歌词时悬浮球下方的半透明歌词条
  const lyricBubble = targetDocument.createElement('div');
  lyricBubble.className = 'lyric-bubble';
  const lyricScroll = targetDocument.createElement('span');
  lyricScroll.className = 'lyric-scroll';
  lyricBubble.appendChild(lyricScroll);
  shadow.appendChild(lyricBubble);

  // 歌词滚动动画定时器句柄
  let _lyricAnimTimer: number | null = null;

  // 更新歌词条位置：始终位于悬浮球正下方，悬浮窗打开时会被遮盖一部分
  function positionLyricBubble() {
    const bLeft = parseFloat(ball.style.left) || 0;
    const bTop = parseFloat(ball.style.top) || 0;
    const GAP = 6;
    lyricBubble.classList.remove('on-left', 'on-right');
    lyricBubble.style.left = `${bLeft + CONFIG.BALL_SIZE / 2}px`;
    lyricBubble.style.transform = 'translateX(-50%)';
    lyricBubble.style.top = `${bTop + CONFIG.BALL_SIZE + GAP}px`;
  }
  positionLyricBubble();

  // 图片等比放大1.5倍：读取图片自然尺寸，计算contain后×1.5的精确background-size
  const _ballImg = new Image();
  _ballImg.onload = () => {
    const fitScale = Math.min(CONFIG.BALL_SIZE / _ballImg.naturalWidth, CONFIG.BALL_SIZE / _ballImg.naturalHeight);
    const w = _ballImg.naturalWidth * fitScale * 1.5;
    const h = _ballImg.naturalHeight * fitScale * 1.5;
    ball.style.backgroundSize = `${w}px ${h}px`;
  };
  _ballImg.src = ballImage;

  const panel = targetDocument.createElement('div');
  panel.className = 'control-panel';
  panel.innerHTML = `
    <div class="panel-header"></div>
    <div class="panel-body">
      <div class="device-shell">
        <span class="close-btn">⚓</span>
        <div class="device-status">
          <span id="deviceTime">{{time}}</span>
          <span id="deviceMeta">{{weekday}}☀️{{datetimeformat YYYY年MM月DD日}}</span>
        </div>
        <div class="device-screen">
          <div class="page desktop-page active" id="desktopPage">
            <div class="app-grid">
              <div class="app-item" data-app="chat">
                <div class="app-icon chat-icon">💬</div>
                <div class="app-name">微信聊天</div>
              </div>
              <div class="app-item" data-app="regex">
                <div class="app-icon regex-icon">🔁</div>
                <div class="app-name">打码助手</div>
              </div>
              <div class="app-item" data-app="aquarium">
                <div class="app-icon aquarium-icon">
                  <span class="aq-island">🏝️</span>
                  <span class="aq-turtle">🐢</span>
                </div>
                <div class="app-name">仿此间鱼缸</div>
              </div>
              <div class="app-item" data-app="music">
                <div class="app-icon music-icon">🎵</div>
                <div class="app-name">云音乐</div>
              </div>
              <div class="app-item" data-app="setting">
                <div class="app-icon setting-icon">⚙️</div>
                <div class="app-name">设置</div>
              </div>
            </div>
          </div>

          <div class="page regex-page" id="regexPage">
            <div class="chat-header">
              <span class="back-btn regex-back">←</span>
              <span class="chat-title">打码助手</span>
            </div>
            <div class="regex-rules" id="regexRules"></div>
            <div class="regex-actions">
              <button id="addRegexBtn" class="ghost-btn" type="button">➕ 添加规则</button>
              <button id="saveRegexBtn" class="primary-btn" type="button">保存到酒馆</button>
            </div>
          </div>

          <div class="page music-page" id="musicPage">
            <div class="chat-header">
              <span class="back-btn music-back">←</span>
              <span class="chat-title">云音乐</span>
            </div>
            <!-- 歌曲列表最上方：选择歌单 + 新建歌单 -->
            <div class="music-playlist-bar">
              <div class="music-playlists" id="musicPlaylists"></div>
              <button id="musicDeletePlaylistBtn" class="music-delete-playlist" type="button" title="删除当前歌单" style="display:none;">🗑</button>
              <button id="musicNewPlaylistBtn" class="music-new-playlist" type="button" title="新建歌单">＋</button>
            </div>
            <div class="music-new-playlist-form" id="musicNewPlaylistForm" style="display:none;">
              <input id="musicNewPlaylistName" class="music-search-input" type="text" placeholder="输入歌单名称..." maxlength="20" />
              <button id="musicNewPlaylistConfirm" class="primary-btn" type="button">确定</button>
              <button id="musicNewPlaylistCancel" class="ghost-btn" type="button">取消</button>
            </div>
            <div class="music-add-playlist-form" id="musicAddPlaylistForm" style="display:none;">
              <div class="music-add-playlist-title">选择收藏夹</div>
              <div class="music-add-playlist-list" id="musicAddPlaylistList"></div>
              <button id="musicAddPlaylistCancel" class="ghost-btn" type="button">取消</button>
            </div>
            <div class="music-add-playlist-form" id="musicDeleteConfirmForm" style="display:none;">
              <div class="music-add-playlist-title" id="musicDeleteConfirmText">确定删除该歌单吗？</div>
              <div class="music-add-playlist-actions">
                <button id="musicDeleteConfirmYes" class="primary-btn" type="button">确定</button>
                <button id="musicDeleteConfirmNo" class="ghost-btn" type="button">取消</button>
              </div>
            </div>
            <div class="music-list" id="musicList"></div>
            <div class="music-player" id="musicPlayer">
              <div class="music-info">
                <div class="music-title" id="musicTitle">未播放</div>
                <div class="music-artist" id="musicArtist"></div>
              </div>
              <div class="music-progress">
                <span class="music-time" id="musicCurrent">00:00</span>
                <input type="range" id="musicProgress" class="music-range" min="0" max="100" value="0" />
                <span class="music-time" id="musicDuration">00:00</span>
              </div>
              <div class="music-controls">
                <button id="musicSearchBtn" class="music-btn" type="button" title="搜索歌曲">🔍</button>
                <button id="musicRecommendBtn" class="music-btn" type="button" title="推荐歌曲">🎯</button>
                <button id="musicPrevBtn" class="music-btn" type="button">⏮</button>
                <button id="musicPlayBtn" class="music-btn music-play" type="button">▶</button>
                <button id="musicNextBtn" class="music-btn" type="button">⏭</button>
                <button id="musicModeBtn" class="music-btn" type="button" title="播放模式：顺序">🔄</button>
                <button id="musicQueueBtn" class="music-btn" type="button" title="播放列表">📃</button>
              </div>
              <div class="music-volume">
                <span class="music-vol-icon">🔊</span>
                <input type="range" id="musicVolume" class="music-range" min="0" max="100" value="80" />
              </div>
              <div class="music-lyric" id="musicLyric"></div>
            </div>
            <!-- 独立搜索弹窗（小于主页面，再次点搜索取消） -->
            <div class="music-search-overlay" id="musicSearchOverlay" style="display:none;">
              <div class="music-search-bar">
                <input id="musicSearchInput" class="music-search-input" type="text" placeholder="搜索歌曲 / 歌手..." />
                <button id="musicSearchGoBtn" class="ghost-btn" type="button">搜索</button>
              </div>
              <div class="music-search-results" id="musicSearchResults"></div>
            </div>
            <div class="music-queue" id="musicQueueList" style="display:none;"></div>
            <div class="music-recommend-panel" id="musicRecommendPanel" style="display:none;">
              <div class="music-recommend-status" id="musicRecommendStatus">正在查找...</div>
              <div class="music-recommend-song" id="musicRecommendSong"></div>
              <div class="music-recommend-actions" id="musicRecommendActions" style="display:none;">
                <button id="musicRecommendGiveup" class="ghost-btn" type="button">算了吧</button>
                <button id="musicRecommendAgain" class="ghost-btn" type="button">换一首</button>
                <button id="musicRecommendPlay" class="primary-btn" type="button">播放</button>
              </div>
            </div>
          </div>

          <div class="page chat-page" id="chatPage">
            <div class="chat-header">
              <span class="back-btn chat-back">←</span>
              <span class="chat-title">AI助手</span>
            </div>
            <div class="chat-message-wrap" id="chatMessageWrap"></div>
            <div class="chat-input-bar">
              <textarea id="chatInput" class="chat-input" rows="1" placeholder="输入消息..."></textarea>
              <button id="sendMsgBtn" class="send-btn">发送</button>
            </div>
          </div>

          <div class="modal" id="settingModal">
            <!-- 设置主页：API配置入口 + 悬浮球动画开关 -->
            <div id="settingHomePanel" class="modal-content setting-home">
              <h3>设置</h3>
              <div class="setting-menu">
                <button id="openApiConfigBtn" class="setting-menu-item" type="button">
                  <span class="setting-menu-icon">🔑</span>
                  <span>API 配置</span>
                  <span class="setting-menu-arrow">›</span>
                </button>
                <div class="setting-menu-item setting-toggle-row">
                  <span class="setting-menu-icon">✨</span>
                  <span>悬浮球动画</span>
                  <label class="switch">
                    <input id="ballAnimToggle" type="checkbox" checked />
                    <span class="slider"></span>
                  </label>
                </div>
              </div>
              <div class="setting-footer">
                <button id="settingSaveBtn" class="primary-btn" type="button">保存配置</button>
                <button id="settingExitBtn" class="ghost-btn" type="button">退出</button>
              </div>
            </div>
            <!-- API 配置面板 -->
            <div id="apiConfigPanel" class="modal-content setting-api" style="display:none;">
              <h3>模型API配置</h3>

              <div class="field">
                <label>API接口地址（填入v1基础地址即可）</label>
                <input id="inputApiUrl" type="text" placeholder="http://127.0.0.1:2156/v1" />
              </div>

              <div class="field">
                <label>API Key</label>
                <input id="inputApiKey" type="text" />
              </div>

              <div class="field">
                <label>模型（可缓存复用，无需每次重新拉取）</label>
                <div class="field-row">
                  <select id="modelSelect"></select>
                  <button id="fetchModelBtn" class="ghost-btn" type="button">获取模型</button>
                </div>
              </div>

              <div class="action-row">
                <button id="backFromApiBtn" class="ghost-btn" type="button">返回</button>
                <button id="saveSettingBtn" class="primary-btn" type="button">保存配置</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  shadow.appendChild(panel);

  // =========================================================
  // 4) 新文件22 的配置逻辑：读取本地缓存、拉取模型列表、保存参数
  //    这里保留原始逻辑并做了适配：默认保存的是完整 chat/completions 地址。
  // =========================================================
  const state = {
    apiUrl: '',
    apiKey: '',
    modelName: '',
  };

  const inputApiUrl = panel.querySelector('#inputApiUrl') as HTMLInputElement;
  const inputApiKey = panel.querySelector('#inputApiKey') as HTMLInputElement;
  const modelSelect = panel.querySelector('#modelSelect') as HTMLSelectElement;
  const fetchModelBtn = panel.querySelector('#fetchModelBtn') as HTMLButtonElement;
  const saveSettingBtn = panel.querySelector('#saveSettingBtn') as HTMLButtonElement;
  const settingModal = panel.querySelector('#settingModal') as HTMLDivElement;
  const settingHomePanel = panel.querySelector('#settingHomePanel') as HTMLDivElement;
  const apiConfigPanel = panel.querySelector('#apiConfigPanel') as HTMLDivElement;
  const openApiConfigBtn = panel.querySelector('#openApiConfigBtn') as HTMLButtonElement;
  const backFromApiBtn = panel.querySelector('#backFromApiBtn') as HTMLButtonElement;
  const ballAnimToggle = panel.querySelector('#ballAnimToggle') as HTMLInputElement;
  const settingSaveBtn = panel.querySelector('#settingSaveBtn') as HTMLButtonElement;
  const settingExitBtn = panel.querySelector('#settingExitBtn') as HTMLButtonElement;
  const chatMessageWrap = panel.querySelector('#chatMessageWrap') as HTMLDivElement;
  const chatInput = panel.querySelector('#chatInput') as HTMLTextAreaElement;
  const sendMsgBtn = panel.querySelector('#sendMsgBtn') as HTMLButtonElement;
  const desktopPage = panel.querySelector('#desktopPage') as HTMLDivElement;
  const chatPage = panel.querySelector('#chatPage') as HTMLDivElement;
  const regexPage = panel.querySelector('#regexPage') as HTMLDivElement;
  const regexRules = panel.querySelector('#regexRules') as HTMLDivElement;
  const addRegexBtn = panel.querySelector('#addRegexBtn') as HTMLButtonElement;
  const saveRegexBtn = panel.querySelector('#saveRegexBtn') as HTMLButtonElement;
  const musicPage = panel.querySelector('#musicPage') as HTMLDivElement;
  const musicSearchInput = panel.querySelector('#musicSearchInput') as HTMLInputElement;
  const musicSearchBtn = panel.querySelector('#musicSearchBtn') as HTMLButtonElement;
  const musicSearchGoBtn = panel.querySelector('#musicSearchGoBtn') as HTMLButtonElement;
  const musicSearchOverlay = panel.querySelector('#musicSearchOverlay') as HTMLDivElement;
  const musicSearchResults = panel.querySelector('#musicSearchResults') as HTMLDivElement;
  const musicList = panel.querySelector('#musicList') as HTMLDivElement;
  const musicTitle = panel.querySelector('#musicTitle') as HTMLDivElement;
  const musicArtist = panel.querySelector('#musicArtist') as HTMLDivElement;
  const musicCurrent = panel.querySelector('#musicCurrent') as HTMLSpanElement;
  const musicDuration = panel.querySelector('#musicDuration') as HTMLSpanElement;
  const musicProgress = panel.querySelector('#musicProgress') as HTMLInputElement;
  const musicPrevBtn = panel.querySelector('#musicPrevBtn') as HTMLButtonElement;
  const musicPlayBtn = panel.querySelector('#musicPlayBtn') as HTMLButtonElement;
  const musicNextBtn = panel.querySelector('#musicNextBtn') as HTMLButtonElement;
  const musicVolume = panel.querySelector('#musicVolume') as HTMLInputElement;
  const musicLyric = panel.querySelector('#musicLyric') as HTMLDivElement;
  const musicPlaylistsBar = panel.querySelector('#musicPlaylists') as HTMLDivElement;
  const musicDeletePlaylistBtn = panel.querySelector('#musicDeletePlaylistBtn') as HTMLButtonElement;
  const musicNewPlaylistBtn = panel.querySelector('#musicNewPlaylistBtn') as HTMLButtonElement;
  const musicNewPlaylistForm = panel.querySelector('#musicNewPlaylistForm') as HTMLDivElement;
  const musicNewPlaylistName = panel.querySelector('#musicNewPlaylistName') as HTMLInputElement;
  const musicNewPlaylistConfirm = panel.querySelector('#musicNewPlaylistConfirm') as HTMLButtonElement;
  const musicNewPlaylistCancel = panel.querySelector('#musicNewPlaylistCancel') as HTMLButtonElement;
  const musicAddPlaylistForm = panel.querySelector('#musicAddPlaylistForm') as HTMLDivElement;
  const musicAddPlaylistList = panel.querySelector('#musicAddPlaylistList') as HTMLDivElement;
  const musicAddPlaylistCancel = panel.querySelector('#musicAddPlaylistCancel') as HTMLButtonElement;
  const musicDeleteConfirmForm = panel.querySelector('#musicDeleteConfirmForm') as HTMLDivElement;
  const musicDeleteConfirmText = panel.querySelector('#musicDeleteConfirmText') as HTMLDivElement;
  const musicDeleteConfirmYes = panel.querySelector('#musicDeleteConfirmYes') as HTMLButtonElement;
  const musicDeleteConfirmNo = panel.querySelector('#musicDeleteConfirmNo') as HTMLButtonElement;
  const musicModeBtn = panel.querySelector('#musicModeBtn') as HTMLButtonElement;
  const musicRecommendBtn = panel.querySelector('#musicRecommendBtn') as HTMLButtonElement;
  const musicQueueList = panel.querySelector('#musicQueueList') as HTMLDivElement;
  const musicRecommendPanel = panel.querySelector('#musicRecommendPanel') as HTMLDivElement;
  const musicRecommendStatus = panel.querySelector('#musicRecommendStatus') as HTMLDivElement;
  const musicRecommendSong = panel.querySelector('#musicRecommendSong') as HTMLDivElement;
  const musicRecommendActions = panel.querySelector('#musicRecommendActions') as HTMLDivElement;
  const musicRecommendGiveup = panel.querySelector('#musicRecommendGiveup') as HTMLButtonElement;
  const musicRecommendAgain = panel.querySelector('#musicRecommendAgain') as HTMLButtonElement;
  const musicRecommendPlay = panel.querySelector('#musicRecommendPlay') as HTMLButtonElement;
  const musicQueueBtn = panel.querySelector('#musicQueueBtn') as HTMLButtonElement;
  const closeBtn = panel.querySelector('.close-btn') as HTMLElement;
  const header = panel.querySelector('.panel-header') as HTMLElement;
  const deviceTime = panel.querySelector('#deviceTime') as HTMLElement;
  const deviceMeta = panel.querySelector('#deviceMeta') as HTMLElement;

  // {{time}} 宏替换为当前时间（HH:MM），{{weekday}} 替换为星期几，
  // 太阳/月亮图标按 6-18 点为 ☀️、其余为 🌙，日期为 DD.MM.YYYY
  const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  function updateDeviceTime() {
    if (!deviceTime) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    deviceTime.textContent = `${hh}:${mm}`;
    if (deviceMeta) {
      const hour = now.getHours();
      const icon = hour >= 6 && hour < 18 ? '☀️' : '🌙';
      const dd = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      deviceMeta.textContent = `${WEEKDAYS[now.getDay()]}${icon}${now.getFullYear()}年${month}月${dd}日`;
    }
  }
  updateDeviceTime();
  setInterval(updateDeviceTime, 10000);

  function loadConfigFromLocal() {
    try {
      const saved = localStorage.getItem('ai_config');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      state.apiUrl = parsed.apiUrl || '';
      state.apiKey = parsed.apiKey || '';
      state.modelName = parsed.modelName || '';
      inputApiKey.value = state.apiKey || '';
      // 回填 API 地址（去掉 /chat/completions 后缀，显示为 v1 基础地址）
      if (state.apiUrl) {
        inputApiUrl.value = state.apiUrl.replace(/\/chat\/completions$/, '');
      }
      restoreModelsFromCache();
    } catch (error) {
      console.warn('[悬浮窗测试] 配置读取失败', error);
    }
  }

  // 从缓存恢复该 API 地址对应的模型列表，避免每次重新拉取
  function restoreModelsFromCache() {
    if (!state.apiUrl) return;
    try {
      const cached = localStorage.getItem('ai_models_' + state.apiUrl);
      if (!cached) return;
      const models = JSON.parse(cached);
      if (!Array.isArray(models) || models.length === 0) return;
      modelSelect.innerHTML = '';
      models.forEach((id: string) => {
        const option = targetDocument.createElement('option');
        option.value = id;
        option.textContent = id;
        if (id === state.modelName) option.selected = true;
        modelSelect.appendChild(option);
      });
    } catch (e) {
      // 缓存损坏则忽略
    }
  }

  function saveConfigToLocal() {
    localStorage.setItem('ai_config', JSON.stringify(state));
  }

  function appendMessage(text: string, role: 'ai' | 'user') {
    const div = targetDocument.createElement('div');
    div.className = `msg-item ${role}`;
    div.innerHTML = `<div class="msg-bubble">${text}</div>`;
    chatMessageWrap.appendChild(div);
    chatMessageWrap.scrollTop = chatMessageWrap.scrollHeight;
  }

  function showPage(pageName: 'desktop' | 'chat' | 'regex' | 'music' | 'setting') {
    if (pageName === 'desktop') {
      desktopPage.classList.add('active');
      chatPage.classList.remove('active');
      regexPage.classList.remove('active');
      musicPage.classList.remove('active');
      settingModal.classList.remove('show');
    }
    if (pageName === 'chat') {
      desktopPage.classList.remove('active');
      chatPage.classList.add('active');
      regexPage.classList.remove('active');
      musicPage.classList.remove('active');
      settingModal.classList.remove('show');
    }
    if (pageName === 'regex') {
      desktopPage.classList.remove('active');
      chatPage.classList.remove('active');
      regexPage.classList.add('active');
      musicPage.classList.remove('active');
      settingModal.classList.remove('show');
    }
    if (pageName === 'music') {
      desktopPage.classList.remove('active');
      chatPage.classList.remove('active');
      regexPage.classList.remove('active');
      musicPage.classList.add('active');
      settingModal.classList.remove('show');
      // 再次进入音乐页面时恢复推荐弹窗
      restoreRecommendIfAny();
    }
    if (pageName === 'setting') {
      desktopPage.classList.remove('active');
      chatPage.classList.remove('active');
      regexPage.classList.remove('active');
      musicPage.classList.remove('active');
      settingModal.classList.add('show');
      // 每次打开设置都回到设置主页，并同步动画开关状态
      settingHomePanel.style.display = 'flex';
      apiConfigPanel.style.display = 'none';
      try {
        ballAnimToggle.checked = localStorage.getItem('ai_ball_anim') !== '0';
      } catch (e) {
        ballAnimToggle.checked = true;
      }
    }
    // ⚓ 关闭按钮只在桌面页显示
    closeBtn.style.display = pageName === 'desktop' ? '' : 'none';
  }

  // 新文件22 的拉取模型列表逻辑：基于输入的 v1 地址，自动请求 /models
  async function pullModelList() {
    const userInputUrl = inputApiUrl.value.trim();
    const key = inputApiKey.value.trim();

    if (!userInputUrl || !key) {
      alert('请先填写API地址和API Key');
      return;
    }

    let baseEndpoint = userInputUrl;
    if (baseEndpoint.endsWith('/chat/completions')) {
      baseEndpoint = baseEndpoint.slice(0, -'/chat/completions'.length);
    }
    if (!baseEndpoint.endsWith('/')) baseEndpoint += '/';
    const modelsApiUrl = new URL('models', baseEndpoint).href;

    fetchModelBtn.disabled = true;
    modelSelect.innerHTML = '<option value="">加载中...</option>';

    try {
      const response = await fetch(modelsApiUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}，地址:${modelsApiUrl}`);
      }

      const json = await response.json();
      const models = Array.isArray(json.data) ? json.data : [];
      modelSelect.innerHTML = '';

      if (models.length === 0) {
        modelSelect.innerHTML = '<option value="">未获取到模型</option>';
        return;
      }

      models.forEach((item: any) => {
        const option = targetDocument.createElement('option');
        option.value = item.id;
        option.textContent = item.id;
        if (item.id === state.modelName) option.selected = true;
        modelSelect.appendChild(option);
      });

      // 缓存本次拉取的模型列表（按补全后的 chatUrl 作 key），下次打开设置直接恢复，无需重新拉取
      const cacheModels = models.map((item: any) => item.id);
      let cacheUrl = userInputUrl;
      if (!cacheUrl.endsWith('/chat/completions')) {
        if (cacheUrl.endsWith('/')) cacheUrl += 'chat/completions';
        else cacheUrl += '/chat/completions';
      }
      try {
        localStorage.setItem('ai_models_' + cacheUrl, JSON.stringify(cacheModels));
      } catch (e) {
        // 忽略缓存失败
      }
    } catch (error: any) {
      const message = error?.message || String(error);
      console.error('[悬浮窗测试] 拉取模型失败', error);
      let displayMessage = message;
      if (message.includes('CORS') || message.includes('Failed to fetch')) {
        displayMessage = '跨域被拦截！浏览器网页直接访问本地服务需要开启CORS';
      }
      modelSelect.innerHTML = `<option value="">拉取失败:${displayMessage}</option>`;
    } finally {
      fetchModelBtn.disabled = false;
    }
  }

  // 保存配置：自动补全成 /chat/completions，和新文件22 完全一致。
  function saveSettings() {
    const selectedModel = modelSelect.value;
    if (!selectedModel || selectedModel.startsWith('加载') || selectedModel.startsWith('未获取') || selectedModel.startsWith('拉取失败')) {
      alert('请先成功拉取模型列表并选择一个模型');
      return;
    }

    const userRawUrl = inputApiUrl.value.trim();
    let finalChatUrl = userRawUrl;
    if (!finalChatUrl.endsWith('/chat/completions')) {
      if (finalChatUrl.endsWith('/')) {
        finalChatUrl += 'chat/completions';
      } else {
        finalChatUrl += '/chat/completions';
      }
    }

    state.apiUrl = finalChatUrl;
    state.apiKey = inputApiKey.value.trim();
    state.modelName = selectedModel;
    saveConfigToLocal();
    // 保存成功后回到设置主页（保持设置弹窗打开）
    settingHomePanel.style.display = 'flex';
    apiConfigPanel.style.display = 'none';
    appendMessage('✅ 配置已保存，可以开始对话', 'ai');
  }

  // 读取本地缓存，并回填 API key（注意：这里不回填 inputApiUrl，保持和新文件22 一致）
  loadConfigFromLocal();

  // 点击桌面图标时的交互：新文件22 的功能动作和显示顺序保持不变。
  panel.querySelectorAll('.app-item').forEach((item) => {
    item.addEventListener('click', () => {
      const appType = (item as HTMLElement).dataset.app;
      if (appType === 'chat') {
        showPage('chat');
      } else if (appType === 'regex') {
        showPage('regex');
      } else if (appType === 'music') {
        showPage('music');
      } else if (appType === 'setting') {
        inputApiUrl.value = state.apiUrl ? state.apiUrl.replace(/\/chat\/completions$/, '') : inputApiUrl.value;
        showPage('setting');
      }
    });
  });

  panel.querySelector('.chat-back')?.addEventListener('click', () => {
    showPage('desktop');
  });
  panel.querySelector('.regex-back')?.addEventListener('click', () => {
    showPage('desktop');
  });
  panel.querySelector('.music-back')?.addEventListener('click', () => {
    showPage('desktop');
  });

  fetchModelBtn.addEventListener('click', pullModelList);
  saveSettingBtn.addEventListener('click', saveSettings);

  // 设置两层面板切换：设置主页 <-> API 配置
  openApiConfigBtn.addEventListener('click', () => {
    settingHomePanel.style.display = 'none';
    apiConfigPanel.style.display = 'flex';
  });
  backFromApiBtn.addEventListener('click', () => {
    settingHomePanel.style.display = 'flex';
    apiConfigPanel.style.display = 'none';
  });

  // 悬浮球动画开关：默认开启，关闭后悬浮球静止（不冒 emoji、不随节奏浮动，及后续动画）
  let ballAnimEnabled = true;
  try {
    ballAnimEnabled = localStorage.getItem('ai_ball_anim') !== '0';
  } catch (e) {
    ballAnimEnabled = true;
  }
  ballAnimToggle.checked = ballAnimEnabled;
  ballAnimToggle.addEventListener('change', () => {
    ballAnimEnabled = ballAnimToggle.checked;
    try { localStorage.setItem('ai_ball_anim', ballAnimEnabled ? '1' : '0'); } catch (e) {}
  });

  // 设置主页"保存配置"按钮：保存当前设置（动画开关等）并给出提示
  settingSaveBtn.addEventListener('click', () => {
    ballAnimEnabled = ballAnimToggle.checked;
    try { localStorage.setItem('ai_ball_anim', ballAnimEnabled ? '1' : '0'); } catch (e) {}
    appendMessage('✅ 设置已保存', 'ai');
  });

  // 设置主页"退出"按钮：关闭设置弹窗回到主页
  settingExitBtn.addEventListener('click', () => {
    showPage('desktop');
  });

  // =========================================================
  // 4.5) 文本替换（正则）快捷编辑：将指定文本替换为文字或本地图片
  //      规则保存到酒馆全局正则，聊天显示时自动生效。
  // =========================================================
  const REGEX_STORAGE_KEY = 'ta_float_regex_rules';
  const REGEX_NAME_PREFIX = '悬浮窗替换-';

  function escapeHtml(str: string): string {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function collectRegexRules(): { find: string; replace: string; enabled: boolean }[] {
    const rules: { find: string; replace: string; enabled: boolean }[] = [];
    regexRules.querySelectorAll('.regex-rule').forEach((el) => {
      const find = (el.querySelector('.regex-find') as HTMLInputElement).value;
      const replace = (el.querySelector('.regex-replace') as HTMLTextAreaElement).value;
      const enabled = (el.querySelector('.regex-enabled') as HTMLInputElement).checked;
      rules.push({ find, replace, enabled });
    });
    return rules;
  }

  function renderRegexRules(rules: { find: string; replace: string; enabled: boolean }[]) {
    regexRules.innerHTML = '';
    if (rules.length === 0) {
      regexRules.innerHTML = '<div class="regex-empty">暂无替换规则，点击下方「➕ 添加规则」开始编辑</div>';
    }
    rules.forEach((rule, idx) => {
      const div = targetDocument.createElement('div');
      div.className = 'regex-rule';
      div.innerHTML = `
        <input type="text" class="regex-find" placeholder="查找文本（如：替换文字）" />
        <textarea class="regex-replace" rows="2" placeholder="替换为文字"></textarea>
        <div class="regex-rule-row">
          <label><input type="checkbox" class="regex-enabled" checked /> 启用</label>
          <button class="regex-del" type="button">🗑 删除</button>
        </div>
      `;
      (div.querySelector('.regex-find') as HTMLInputElement).value = rule.find;
      (div.querySelector('.regex-replace') as HTMLTextAreaElement).value = rule.replace;
      (div.querySelector('.regex-enabled') as HTMLInputElement).checked = rule.enabled;
      div.querySelector('.regex-del')?.addEventListener('click', () => {
        div.remove();
        if (regexRules.children.length === 0) {
          regexRules.innerHTML = '<div class="regex-empty">暂无替换规则，点击下方「➕ 添加规则」开始编辑</div>';
        }
      });
      regexRules.appendChild(div);
    });
  }

  function loadRegexRules() {
    try {
      const saved = localStorage.getItem(REGEX_STORAGE_KEY);
      const rules = saved ? JSON.parse(saved) : [];
      renderRegexRules(Array.isArray(rules) ? rules : []);
    } catch (error) {
      console.warn('[悬浮窗测试] 正则规则读取失败', error);
      renderRegexRules([]);
    }
  }

  addRegexBtn.addEventListener('click', () => {
    // 移除空提示
    const empty = regexRules.querySelector('.regex-empty');
    if (empty) empty.remove();
    renderRegexRules([...collectRegexRules(), { find: '', replace: '', enabled: true }]);
  });

  saveRegexBtn.addEventListener('click', async () => {
    const rules = collectRegexRules().filter(r => r.find.trim());
    localStorage.setItem(REGEX_STORAGE_KEY, JSON.stringify(rules));
    if (rules.length === 0) {
      alert('请先添加至少一条替换规则');
      return;
    }
    try {
      await updateTavernRegexesWith(
        (regexes) => {
          const kept = regexes.filter(r => !r.script_name.startsWith(REGEX_NAME_PREFIX));
          rules.forEach((rule, i) => {
            // 被替换内容用主题色边框框住，边框颜色跟随酒馆美化主题
            const borderStyle = 'display:inline-block;border:2px solid var(--SmartThemeUnderlineColor);border-radius:6px;padding:2px 6px;';
            // 自动识别图片路径/URL：以协议、盘符、斜杠开头，或图片扩展名结尾
            const isImage =
              /^(https?:\/\/|file:\/\/|\/|[a-zA-Z]:\\)/i.test(rule.replace.trim()) ||
              /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(rule.replace.trim());
            let replaceString: string;
            if (isImage) {
              replaceString = `<span style="${borderStyle}"><img src="${rule.replace.trim()}" style="max-width:180px;border-radius:4px;display:block;"></span>`;
            } else {
              replaceString = `<span style="${borderStyle}">${rule.replace}</span>`;
            }
            kept.push({
              id: `ta_float_regex_${i}_${Date.now()}`,
              script_name: REGEX_NAME_PREFIX + (rule.find.slice(0, 12) || `rule${i + 1}`),
              enabled: rule.enabled,
              find_regex: rule.find,
              replace_string: replaceString,
              trim_strings: [],
              source: { user_input: true, ai_output: true, slash_command: false, world_info: false, reasoning: false },
              destination: { display: true, prompt: false },
              run_on_edit: true,
              min_depth: null,
              max_depth: null,
            });
          });
          return kept;
        },
        { type: 'global' },
      );
      alert(`已保存 ${rules.length} 条替换规则到酒馆全局正则`);
      showPage('desktop');
    } catch (error: any) {
      console.error('[悬浮窗测试] 保存正则失败', error);
      alert('保存失败：' + (error?.message || String(error)));
    }
  });

  loadRegexRules();

  // =========================================================
  // 4.6) 云音乐：仿网易云音乐，搜索/播放/独立音量/后台持续播放
  //      使用 GD Studio 免费音乐 API（聚合网易云等曲库）
  // =========================================================
  const MUSIC_API = 'https://music-api.gdstudio.xyz/api.php';
  // 多音乐源：来源按优先级顺序尝试，一个失败则降级到下一个，保证搜索/播放/歌词稳定
  const MUSIC_SOURCES = ['netease', 'kuwo', 'migu', 'kugou', 'xiami', 'l1ing0'];
  const MUSIC_API_BACKUP = 'https://api-melodies.vercel.app/api';
  // 并行请求多个来源，返回第一个成功的结果；全部失败返回 null
  async function requestMusicAction(
    type: 'search' | 'url' | 'lyric',
    params: Record<string, string>,
  ): Promise<any | null> {
    // 优先从 GD Studio 多源依次尝试
    for (const src of MUSIC_SOURCES) {
      try {
        const url = `${MUSIC_API}?types=${type}&source=${src}&${new URLSearchParams(params)}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const json = await res.json();
        const data = Array.isArray(json) ? json : json;
        // 搜索结果空则视为该源无结果，尝试下一源
        if (Array.isArray(data) && data.length === 0) continue;
        if (data && typeof data === 'object' && ('url' in data) && !data.url && type === 'url') continue;
        return data;
      } catch (e) {
        // 继续尝试下一个源
      }
    }
    // GD Studio 全部失败，尝试备用 API（Melodies）
    try {
      const api = MUSIC_API_BACKUP;
      if (type === 'search') {
        const res = await fetch(`${api}?${new URLSearchParams({ query: params.name || '', limit: '20' })}`);
        if (res.ok) {
          const json = await res.json();
          return Array.isArray(json) ? json : (json?.data || null);
        }
      }
    } catch (e) {
      // 备用也失败
    }
    return null;
  }
  // 后台播放：Audio 对象独立于面板 DOM，关闭面板后音乐继续播放
  const musicAudio = new Audio();
  musicAudio.volume = 0.8;
  // 跨域音频需要 anonymous 才能用 Web Audio 分析节奏
  musicAudio.crossOrigin = 'anonymous';
  let musicQueue: { id: string; name: string; artist: string; url_id: string }[] = [];
  let musicIndex = -1;
  // 播放模式: 'normal'(顺序) | 'shuffle'(随机) | 'single'(单曲循环)
  let musicMode: 'normal' | 'shuffle' | 'single' = 'normal';
  // 当前歌曲的带时间戳歌词数组
  let currentLyricLines: { time: number; text: string }[] = [];
  let _lastLyricIndex = -1;
  // 根据当前播放时间更新悬浮球下方的歌词条
  function startLyricScrollAnimation() {
    // 已移除滚动效果，此函数保留为空以避免调用报错
  }

  function updateLyricBubble() {
    if (musicAudio.paused && !musicAudio.ended) {
      // 暂停时不显示歌词
      lyricBubble.classList.remove('show');
      if (_lyricAnimTimer) { window.clearTimeout(_lyricAnimTimer); _lyricAnimTimer = null; }
      return;
    }
    if (!lyricBubble) return;
    const t = musicAudio.currentTime;
    let idx = -1;
    for (let i = 0; i < currentLyricLines.length; i++) {
      if (t >= currentLyricLines[i].time) {
        idx = i;
      } else {
        break;
      }
    }
    if (idx === -1) {
      lyricBubble.classList.remove('show');
      return;
    }
    if (idx !== _lastLyricIndex) {
      _lastLyricIndex = idx;
      lyricScroll.textContent = currentLyricLines[idx].text;
      positionLyricBubble();
      lyricBubble.classList.add('show');
    }
  }

  // =========================================================
  // 4.6.1) 节奏检测：用 Web Audio 分析正在播放的音频，检测节拍
  //        让悬浮球跟着节奏上下跳动
  // =========================================================
  let _audioCtx: AudioContext | null = null;
  let _analyser: AnalyserNode | null = null;
  let _beatSourceCreated = false;
  let _previousEnergy = 0;
  let _lastBeatAt = 0;

  function initBeatAnalysis() {
    try {
      if (_beatSourceCreated) return;
      const AC = targetWindow.AudioContext || (targetWindow as any).webkitAudioContext;
      if (!AC) return;
      _audioCtx = new AC();
      _audioCtx.resume().catch(() => {});
      _analyser = _audioCtx.createAnalyser();
      _analyser.fftSize = 512;
      _analyser.smoothingTimeConstant = 0.8;
      // 将音频源接入 analyser（自动改道到 analyser，需要再接回 destination 才能出声）
      const source = _audioCtx.createMediaElementSource(musicAudio);
      source.connect(_analyser);
      _analyser.connect(_audioCtx.destination);
      _beatSourceCreated = true;
    } catch (e) {
      console.warn('[悬浮窗测试] 初始化节奏分析失败', e);
    }
  }

  function detectBeat() {
    if (!_analyser || !_audioCtx) return;
    if (musicAudio.paused || musicAudio.ended) return;
    const data = new Uint8Array(_analyser.fftSize);
    _analyser.getByteTimeDomainData(data);
    // 计算 RMS 能量（节拍通常带来能量突增）
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const energy = Math.sqrt(sum / data.length);
    const now = performance.now();
    // 能量明显高于上一帧，且距上次节拍间隔足够，判定为节拍
    if (energy > 0.12 && energy > _previousEnergy * 1.35 && now - _lastBeatAt > 220) {
      _lastBeatAt = now;
      triggerBallBeat();
    }
    _previousEnergy = energy;
  }

  function triggerBallBeat() {
    if (!ballAnimEnabled) return;
    ball.classList.remove('beat');
    void ball.offsetWidth; // 强制 reflow 以重启动画
    ball.classList.add('beat');
  }

  // 播放时启动节奏检测循环
  function startBeatLoop() {
    initBeatAnalysis();
    requestAnimationFrame(function __beatLoop() {
      detectBeat();
      requestAnimationFrame(__beatLoop);
    });
  }

  // 首次播放前初始化节奏检测（在 playMusicByIndex 中调用）

  // ---- 歌单数据 ----
  const PLAYLIST_STORAGE_KEY = 'ta_music_playlists';
  type MusicSong = { id: string; name: string; artist: string; url_id: string };
  let musicPlaylists: { name: string; songs: MusicSong[] }[] = [];
  // 当前查看的歌单名，null 表示搜索结果视图
  let activePlaylistName: string | null = null;

  function savePlaylists() {
    try {
      localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(musicPlaylists));
    } catch (error) {
      console.warn('[悬浮窗测试] 歌单保存失败', error);
    }
  }

  function loadPlaylists() {
    try {
      const saved = localStorage.getItem(PLAYLIST_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      musicPlaylists = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      musicPlaylists = [];
    }
  }

  function getActivePlaylist() {
    return musicPlaylists.find(p => p.name === activePlaylistName) || null;
  }

  function renderPlaylists() {
    musicPlaylistsBar.innerHTML = '';
    // 删除歌单按钮仅在激活了某个歌单时显示
    musicDeletePlaylistBtn.style.display = activePlaylistName ? '' : 'none';
    // 歌单 chips
    musicPlaylists.forEach(pl => {
      const chip = targetDocument.createElement('div');
      chip.className = 'music-playlist-chip' + (activePlaylistName === pl.name ? ' active' : '');
      chip.textContent = `🎵 ${pl.name} (${pl.songs.length})`;
      chip.addEventListener('click', () => {
        activePlaylistName = pl.name;
        renderPlaylists();
        renderMusicList();
      });
      musicPlaylistsBar.appendChild(chip);
    });
  }

  function fmtTime(sec: number): string {
    if (isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function renderMusicList() {
    musicList.innerHTML = '';
    const playlist = getActivePlaylist();
    // 歌单视图：显示歌单歌曲
    if (playlist) {
      if (playlist.songs.length === 0) {
        musicList.innerHTML = '<div class="regex-empty">这个歌单还是空的，去搜索加歌吧</div>';
        return;
      }
      playlist.songs.forEach((song, i) => {
        const item = targetDocument.createElement('div');
        item.className = 'music-item' + (i === musicIndex ? ' active' : '');
        item.innerHTML = `
          <span class="music-item-index">${i === musicIndex ? '🔊' : i + 1}</span>
          <div class="music-item-info">
            <div class="music-item-name">${escapeHtml(song.name)}</div>
            <div class="music-item-artist">${escapeHtml(song.artist)}</div>
          </div>
          <button class="music-item-remove" type="button" title="从歌单移除">✕</button>
        `;
        item.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).classList.contains('music-item-remove')) return;
          musicIndex = i;
          musicQueue = playlist.songs;
          playMusicByIndex();
        });
        const rmBtn = item.querySelector('.music-item-remove') as HTMLButtonElement;
        rmBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          playlist.songs.splice(i, 1);
          if (musicIndex >= playlist.songs.length) musicIndex = -1;
          savePlaylists();
          renderPlaylists();
          renderMusicList();
        });
        musicList.appendChild(item);
      });
      return;
    }
    // 搜索视图：显示搜索结果，带加入歌单按钮
    if (musicQueue.length === 0) {
      musicList.innerHTML = '<div class="regex-empty">输入关键词搜索歌曲</div>';
      return;
    }
    musicQueue.forEach((song, i) => {
      const item = targetDocument.createElement('div');
      item.className = 'music-item' + (i === musicIndex ? ' active' : '');
      item.innerHTML = `
        <span class="music-item-index">${i === musicIndex ? '🔊' : i + 1}</span>
        <div class="music-item-info">
          <div class="music-item-name">${escapeHtml(song.name)}</div>
          <div class="music-item-artist">${escapeHtml(song.artist)}</div>
        </div>
        <button class="music-item-add" type="button" title="加入歌单">＋</button>
      `;
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('music-item-add')) return;
        musicIndex = i;
        playMusicByIndex();
      });
      const addBtn = item.querySelector('.music-item-add') as HTMLButtonElement;
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addToPlaylist(song);
      });
      musicList.appendChild(item);
    });
  }

  function addToPlaylist(song: MusicSong) {
    // 若无歌单则提示先创建
    if (musicPlaylists.length === 0) {
      musicLyric.textContent = '⚠️ 请先点击「＋」新建一个歌单';
      return;
    }
    // 显示收藏夹选择器
    musicAddPlaylistList.innerHTML = '';
    if (musicPlaylists.length === 1) {
      // 只有一个歌单时直接加入
      const pl = musicPlaylists[0];
      addSongToPlaylist(pl, song);
      return;
    }
    musicPlaylists.forEach(pl => {
      const option = targetDocument.createElement('div');
      option.className = 'music-add-playlist-option';
      option.textContent = `${pl.songs.some(s => s.id === song.id) ? '✔ ' : ''}🎵 ${pl.name} (${pl.songs.length})`;
      option.addEventListener('click', () => {
        addSongToPlaylist(pl, song);
        musicAddPlaylistForm.style.display = 'none';
      });
      musicAddPlaylistList.appendChild(option);
    });
    musicAddPlaylistForm.style.display = 'flex';
  }

  function addSongToPlaylist(pl: { name: string; songs: MusicSong[] }, song: MusicSong) {
    if (pl.songs.some(s => s.id === song.id)) {
      musicLyric.textContent = `已在该歌单中`;
      return;
    }
    pl.songs.push({ ...song });
    musicLyric.textContent = `✅ 已加入歌单「${pl.name}」`;
    savePlaylists();
    renderPlaylists();
  }

  // 删除当前歌单：页面内确认
  musicDeletePlaylistBtn.addEventListener('click', () => {
    if (!activePlaylistName) return;
    musicDeleteConfirmText.textContent = `确定删除歌单「${activePlaylistName}」吗？`;
    musicDeleteConfirmForm.style.display = 'flex';
  });

  musicDeleteConfirmYes.addEventListener('click', () => {
    if (!activePlaylistName) return;
    const name = activePlaylistName;
    musicPlaylists = musicPlaylists.filter(p => p.name !== name);
    activePlaylistName = null;
    savePlaylists();
    renderPlaylists();
    renderMusicList();
    musicDeleteConfirmForm.style.display = 'none';
    musicLyric.textContent = `🗑 已删除歌单「${name}」`;
  });

  musicDeleteConfirmNo.addEventListener('click', () => {
    musicDeleteConfirmForm.style.display = 'none';
  });

  musicAddPlaylistCancel.addEventListener('click', () => {
    musicAddPlaylistForm.style.display = 'none';
  });

  async function playMusicByIndex() {
    if (musicIndex < 0 || musicIndex >= musicQueue.length) return;
    const song = musicQueue[musicIndex];
    musicTitle.textContent = song.name;
    musicArtist.textContent = song.artist;
    renderMusicList();
    renderMusicQueue();
    try {
      const urlJson = await requestMusicAction('url', { id: encodeURIComponent(song.url_id || song.id), br: '128' });
      const playUrl = Array.isArray(urlJson) ? urlJson[0]?.url : urlJson?.url;
      if (!playUrl) {
        musicLyric.textContent = '⚠️ 获取播放链接失败（可能受版权限制）';
        return;
      }
      musicAudio.src = playUrl;
      // 节奏检测初始化（首次）
      if (!_beatSourceCreated) {
        try {
          startBeatLoop();
        } catch (e) {
          console.warn('[悬浮窗测试] 节奏检测启动失败', e);
        }
      }
      musicAudio.play().then(() => {
        if (_audioCtx && _audioCtx.state === 'suspended') {
          _audioCtx.resume().catch(() => {});
        }
      }).catch((e) => {
        console.warn('[悬浮窗测试] 自动播放被拦截，请再次点击', e);
        musicLyric.textContent = '⚠️ 点击播放后需再点一次开始（浏览器策略）';
      });
      musicPlayBtn.textContent = '⏸';
      fetchLyric(song.id);
    } catch (error: any) {
      console.error('[悬浮窗测试] 获取播放链接失败', error);
      musicLyric.textContent = '⚠️ 获取播放链接失败';
    }
  }

  // 渲染播放器下方的播放队列列表，供选择切换歌曲
  function renderMusicQueue() {
    musicQueueList.innerHTML = '';
    if (musicQueue.length === 0) {
      musicQueueList.innerHTML = '<div class="regex-empty">播放列表为空</div>';
      return;
    }
    musicQueue.forEach((song, i) => {
      const item = targetDocument.createElement('div');
      item.className = 'music-queue-item' + (i === musicIndex ? ' active' : '');
      item.innerHTML = `
        <span class="music-queue-index">${i === musicIndex ? '🔊' : i + 1}</span>
        <span class="music-queue-name">${escapeHtml(song.name)}</span>
        <span class="music-queue-artist">${escapeHtml(song.artist)}</span>
      `;
      item.addEventListener('click', () => {
        musicIndex = i;
        playMusicByIndex();
      });
      musicQueueList.appendChild(item);
    });
  }

  async function fetchLyric(id: string) {
    try {
      const json = await requestMusicAction('lyric', { id: encodeURIComponent(id) });
      const lyricText = Array.isArray(json) ? json[0]?.lyric : json?.lyric;
      // 解析带时间戳的歌词，存为 { time, text } 数组
      const parsed: { time: number; text: string }[] = [];
      if (lyricText && typeof lyricText === 'string') {
        const lines = lyricText.split('\n');
        for (const line of lines) {
          // 匹配 [mm:ss.xx] 或 [mm:ss] 时间标签
          const timeMatches = line.match(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g);
          if (!timeMatches) continue;
          const lyricTextContent = line.replace(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '').trim();
          if (!lyricTextContent) continue;
          for (const tm of timeMatches) {
            const m = tm.match(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/);
            if (!m) continue;
            const min = parseInt(m[1], 10);
            const sec = parseInt(m[2], 10);
            const fracRaw = m[3];
            let frac = 0;
            if (fracRaw) {
              frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
            }
            const time = min * 60 + sec + frac;
            parsed.push({ time, text: lyricTextContent });
          }
        }
      }
      parsed.sort((a, b) => a.time - b.time);
      currentLyricLines = parsed;
    } catch (error) {
      currentLyricLines = [];
    }
  }

  // 三个弹窗（搜索/推荐/歌曲列表）互斥：打开任意一个先关闭其他两个
  function closeMusicPopups(except: 'search' | 'recommend' | 'queue' | 'none') {
    if (except !== 'search') musicSearchOverlay.style.display = 'none';
    if (except !== 'recommend') musicRecommendPanel.style.display = 'none';
    if (except !== 'queue') musicQueueList.style.display = 'none';
  }

  // 点击播放栏的🔍搜索按钮：切换搜索弹窗显示/隐藏（与其他弹窗互斥）
  musicSearchBtn.addEventListener('click', () => {
    const isHidden = musicSearchOverlay.style.display === 'none' || !musicSearchOverlay.style.display;
    if (isHidden) {
      closeMusicPopups('search');
      musicSearchOverlay.style.display = 'flex';
      musicSearchInput.focus();
    } else {
      musicSearchOverlay.style.display = 'none';
    }
  });

  // 播放列表📃按钮：弹出歌曲队列列表（与其他弹窗互斥）
  musicQueueBtn.addEventListener('click', () => {
    const isHidden = musicQueueList.style.display === 'none' || !musicQueueList.style.display;
    if (isHidden) {
      closeMusicPopups('queue');
      renderMusicQueue();
      musicQueueList.style.display = 'flex';
    } else {
      musicQueueList.style.display = 'none';
    }
  });

  // 搜索页面内点击"搜索"按钮：只展示可成功播放的歌曲
  musicSearchGoBtn.addEventListener('click', async () => {
    const keyword = musicSearchInput.value.trim();
    if (!keyword) return;
    musicSearchResults.innerHTML = '<div class="regex-empty">搜索中...</div>';
    try {
      const json = await requestMusicAction('search', { name: keyword, count: '30' });
      const list = Array.isArray(json) ? json : [];
      if (list.length === 0) {
        musicSearchResults.innerHTML = '<div class="regex-empty">未找到相关歌曲，请更换关键词</div>';
        return;
      }
      musicSearchResults.innerHTML = '';
      // 逐首校验可播放性，只展示可以成功播放的歌（避免版权干扰）
      const songs = list.map((s: any) => ({
        id: String(s.id),
        name: String(s.name || '未知'),
        artist: Array.isArray(s.artist) ? s.artist.join(' / ') : String(s.artist || ''),
        url_id: String(s.url_id || s.id),
      }));
      let shown = 0;
      for (const song of songs) {
        let playUrl = null;
        try {
          const urlJson = await requestMusicAction('url', { id: encodeURIComponent(song.url_id || song.id), br: '128' });
          playUrl = Array.isArray(urlJson) ? urlJson[0]?.url : urlJson?.url;
        } catch (e) {
          playUrl = null;
        }
        if (!playUrl) continue;
        const item = targetDocument.createElement('div');
        item.className = 'music-search-result-item';
        item.innerHTML = `
          <span class="music-item-index">${shown + 1}</span>
          <div class="music-item-info">
            <div class="music-item-name">${escapeHtml(song.name)}</div>
            <div class="music-item-artist">${escapeHtml(song.artist)}</div>
          </div>
          <span style="color:var(--green);font-size:11px;">▶ 可播放</span>
        `;
        item.addEventListener('click', () => {
          // 点击直接播放
          musicQueue = [song];
          musicIndex = 0;
          activePlaylistName = null;
          renderPlaylists();
          renderMusicList();
          musicSearchOverlay.style.display = 'none';
          playMusicByIndex();
        });
        musicSearchResults.appendChild(item);
        shown++;
      }
      if (shown === 0) {
        musicSearchResults.innerHTML = '<div class="regex-empty">这些歌曲都不可播放，请换个关键词</div>';
      }
    } catch (error: any) {
      console.error('[悬浮窗测试] 音乐搜索失败', error);
      musicSearchResults.innerHTML = '<div class="regex-empty">搜索失败，请稍后再试</div>';
    }
  });

  musicSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      musicSearchGoBtn.click();
    }
  });

  musicPlayBtn.addEventListener('click', () => {
    if (!musicAudio.src) {
      if (musicQueue.length > 0) {
        musicIndex = 0;
        playMusicByIndex();
      } else {
        musicLyric.textContent = '⚠️ 请先搜索并选择一首歌';
      }
      return;
    }
    if (musicAudio.paused) {
      musicAudio.play().catch(() => {});
      musicPlayBtn.textContent = '⏸';
    } else {
      musicAudio.pause();
      musicPlayBtn.textContent = '▶';
    }
  });

  musicPrevBtn.addEventListener('click', () => {
    if (musicQueue.length === 0) return;
    musicIndex = (musicIndex - 1 + musicQueue.length) % musicQueue.length;
    playMusicByIndex();
  });

  musicNextBtn.addEventListener('click', () => {
    if (musicQueue.length === 0) return;
    musicIndex = (musicIndex + 1) % musicQueue.length;
    playMusicByIndex();
  });

  musicAudio.addEventListener('timeupdate', () => {
    if (!isNaN(musicAudio.duration)) {
      musicProgress.max = String(musicAudio.duration);
      musicProgress.value = String(musicAudio.currentTime);
      musicCurrent.textContent = fmtTime(musicAudio.currentTime);
      musicDuration.textContent = fmtTime(musicAudio.duration);
    }
    updateLyricBubble();
  });

  musicAudio.addEventListener('play', () => {
    positionLyricBubble();
    lyricBubble.classList.add('show');
  });
  musicAudio.addEventListener('pause', () => {
    lyricBubble.classList.remove('show');
    if (_lyricAnimTimer) {
      window.clearTimeout(_lyricAnimTimer);
      _lyricAnimTimer = null;
    }
  });

  musicAudio.addEventListener('ended', () => {
    musicPlayBtn.textContent = '▶';
    if (musicQueue.length > 0) {
      if (musicMode === 'single') {
        // 单曲循环：重播当前
        musicAudio.currentTime = 0;
        _lastLyricIndex = -1;
        musicAudio.play().catch(() => {});
        musicPlayBtn.textContent = '⏸';
        return;
      }
      if (musicMode === 'shuffle') {
        // 随机：随机选一首（排除当前）
        let next = Math.floor(Math.random() * musicQueue.length);
        if (musicQueue.length > 1 && next === musicIndex) {
          next = (next + 1) % musicQueue.length;
        }
        musicIndex = next;
      } else {
        musicIndex = (musicIndex + 1) % musicQueue.length;
      }
      playMusicByIndex();
    }
  });

  musicAudio.addEventListener('error', () => {
    musicPlayBtn.textContent = '▶';
    musicLyric.textContent = '⚠️ 播放出错，可能受版权限制';
  });

  musicProgress.addEventListener('input', () => {
    if (!isNaN(musicAudio.duration)) {
      musicAudio.currentTime = parseFloat(musicProgress.value);
    }
  });

  musicVolume.addEventListener('input', () => {
    musicAudio.volume = parseFloat(musicVolume.value) / 100;
  });

  // 播放模式切换：顺序 → 随机 → 单曲循环
  const MODE_BTN: Record<'normal' | 'shuffle' | 'single', { icon: string; title: string }> = {
    normal: { icon: '🔄', title: '播放模式：顺序' },
    shuffle: { icon: '🔀', title: '播放模式：随机' },
    single: { icon: '🔂', title: '播放模式：单曲循环' },
  };
  musicModeBtn.addEventListener('click', () => {
    if (musicMode === 'normal') musicMode = 'shuffle';
    else if (musicMode === 'shuffle') musicMode = 'single';
    else musicMode = 'normal';
    musicModeBtn.textContent = MODE_BTN[musicMode].icon;
    musicModeBtn.title = MODE_BTN[musicMode].title;
  });

  // =========================================================
  // 4.7) AI 推荐歌曲：读取聊天记录，让模型分析场景推荐一首歌
  // =========================================================
  let recommendSongName = '';
  let recommendSongId = '';
  let recommendSongUrlId = '';
  // 推荐状态，用于保存/恢复推荐弹窗（搜索后台不终止）
  let recommendState: { status: 'searching' | 'done' | 'failed'; songName: string } | null = null;

  // 用网页配置的 API（设置页填写的 apiUrl/apiKey/modelName）分析聊天场景生成一首歌
  async function askAiRecommendSong(): Promise<{ name: string; id: string; url_id: string } | null> {
    try {
      if (!state.apiUrl || !state.apiKey || !state.modelName) {
        musicRecommendStatus.textContent = '⚠️ 请先在设置页配置 API';
        return null;
      }
      let chatSummary = '';
      try {
        const msgs = getChatMessages(-12);
        chatSummary = msgs
          .map(m => `${m.role}: ${String(m.message).slice(0, 200)}`)
          .join('\n');
      } catch (e) {
        chatSummary = '';
      }
      // 读取用户自定义提示词（localStorage），未设置用默认
      const prompt = localStorage.getItem('ta_music_recommend_prompt') || '请阅读以下聊天记录，分析当前场景和氛围，推荐一首最符合当下情境的歌曲。\n只输出：歌名 - 歌手\n不要输出任何其他文字或解释。\n\n聊天记录：\n' + (chatSummary || '无聊天记录');
      // 直接调用网页配置的 OpenAI 兼容接口
      const res = await fetch(state.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.apiKey}`,
        },
        body: JSON.stringify({
          model: state.modelName,
          messages: [
            { role: 'system', content: '你是一名精通音乐和氛围的推荐助手。根据用户提供的聊天内容，推荐一首最适合当前场景氛围的歌曲，只回复"歌名 - 歌手"格式，不输出任何其他内容。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
        }),
      });
      if (!res.ok) {
        console.warn('[悬浮窗测试] 推荐接口错误', res.status);
        return null;
      }
      const json = await res.json();
      const text = String(json?.choices?.[0]?.message?.content || '');
      // 清理输出，取歌名
      const match = text.match(/[（(]?["《「]?([^"《「」》\n\-—–|]+)[」」》]?["）)]?[\s\-—–|]+([^\n]+)/) || text.match(/(.+?)\s*[-—–|]\s*(.+)/);
      let songName = '';
      if (match) {
        songName = match[1].trim();
      } else {
        songName = text.split('\n')[0].trim();
      }
      // 去引号
      songName = songName.replace(/^["《「'']+|["》」'']+$/g, '').trim();
      if (!songName) return null;

      // 用 GD API 搜索该歌名，取第一首
      const json2 = await requestMusicAction('search', { name: songName, count: '1' });

      const list = Array.isArray(json2) ? json2 : [];
      if (list.length === 0) return null;
      const s = list[0];
      return {
        name: String(s.name || songName),
        id: String(s.id),
        url_id: String(s.url_id || s.id),
      };
    } catch (error: any) {
      console.error('[悬浮窗测试] 推荐歌曲失败', error);
      return null;
    }
  }

  // 推荐歌曲主流程：显示"正在查找"，请求模型，显示推荐结果
  async function startRecommend() {
    closeMusicPopups('recommend');
    musicRecommendPanel.classList.remove('done');
    musicRecommendPanel.style.display = 'flex';
    musicRecommendActions.style.display = 'none';
    musicRecommendSong.textContent = '';
    musicRecommendStatus.innerHTML = '<span class="music-recommend-loading"></span> 正在查找...';
    recommendState = { status: 'searching', songName: '' };
    const rec = await askAiRecommendSong();
    if (rec) {
      recommendSongName = rec.name;
      recommendSongId = rec.id;
      recommendSongUrlId = rec.url_id;
      recommendState = { status: 'done', songName: rec.name };
      musicRecommendStatus.textContent = '为您推荐...!';
      musicRecommendSong.textContent = recommendSongName;
      musicRecommendActions.style.display = 'flex';
      musicRecommendPanel.classList.add('done');
    } else {
      recommendState = { status: 'failed', songName: '' };
      musicRecommendStatus.textContent = '⚠️ 推荐失败，请稍后再试';
      musicRecommendSong.textContent = '';
      musicRecommendActions.style.display = 'flex';
      musicRecommendPanel.classList.add('done');
    }
  }

  // 再次进入音乐页面时恢复推荐弹窗（即使关闭过面板，搜索/结果仍在脚本作用域保留）
  function restoreRecommendIfAny() {
    if (!recommendState) return;
    musicRecommendPanel.style.display = 'flex';
    if (recommendState.status === 'searching') {
      musicRecommendStatus.innerHTML = '<span class="music-recommend-loading"></span> 正在查找...';
      musicRecommendSong.textContent = '';
      musicRecommendActions.style.display = 'none';
      musicRecommendPanel.classList.remove('done');
    } else if (recommendState.status === 'done') {
      musicRecommendStatus.textContent = '为您推荐...!';
      musicRecommendSong.textContent = recommendState.songName;
      musicRecommendActions.style.display = 'flex';
      musicRecommendPanel.classList.add('done');
    } else {
      musicRecommendStatus.textContent = '⚠️ 推荐失败，请稍后再试';
      musicRecommendSong.textContent = '';
      musicRecommendActions.style.display = 'flex';
      musicRecommendPanel.classList.add('done');
    }
  }

  // 播放推荐歌曲
  async function playRecommendedSong() {
    if (!recommendSongId) return;
    musicQueue = [{
      id: recommendSongId,
      name: recommendSongName,
      artist: '',
      url_id: recommendSongUrlId,
    }];
    musicIndex = 0;
    activePlaylistName = null;
    renderPlaylists();
    renderMusicList();
    musicQueueList.style.display = 'none';
    musicRecommendPanel.style.display = 'none';
    recommendState = null;
    await playMusicByIndex();
  }

  musicRecommendBtn.addEventListener('click', startRecommend);
  musicRecommendGiveup.addEventListener('click', () => {
    musicRecommendPanel.style.display = 'none';
    recommendState = null;
  });
  musicRecommendAgain.addEventListener('click', startRecommend);
  musicRecommendPlay.addEventListener('click', playRecommendedSong);

  // 新建歌单：在页面内显示输入表单
  function showNewPlaylistForm() {
    musicNewPlaylistName.value = '';
    musicNewPlaylistForm.style.display = 'flex';
    musicNewPlaylistName.focus();
  }

  function hideNewPlaylistForm() {
    musicNewPlaylistForm.style.display = 'none';
  }

  function createPlaylist() {
    const name = musicNewPlaylistName.value.trim();
    if (!name) return;
    if (musicPlaylists.some(p => p.name === name)) {
      musicLyric.textContent = '⚠️ 已有同名歌单';
      return;
    }
    musicPlaylists.push({ name, songs: [] });
    activePlaylistName = name;
    savePlaylists();
    renderPlaylists();
    renderMusicList();
    hideNewPlaylistForm();
    musicLyric.textContent = `✅ 已创建歌单「${name}」`;
  }

  musicNewPlaylistBtn.addEventListener('click', showNewPlaylistForm);
  musicNewPlaylistConfirm.addEventListener('click', createPlaylist);
  musicNewPlaylistCancel.addEventListener('click', hideNewPlaylistForm);
  musicNewPlaylistName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createPlaylist();
    } else if (e.key === 'Escape') {
      hideNewPlaylistForm();
    }
  });

  // 歌单持久化加载 + 渲染
  loadPlaylists();
  renderPlaylists();

  // 新文件22 的真正发送消息逻辑：直接向 OpenAI 兼容接口发起请求。
  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    if (!state.apiUrl || !state.apiKey || !state.modelName) {
      appendMessage('⚠️ 请先去设置完成API配置', 'ai');
      return;
    }

    appendMessage(text, 'user');
    chatInput.value = '';

    try {
      const response = await fetch(state.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.apiKey}`,
        },
        body: JSON.stringify({
          model: state.modelName,
          messages: [{ role: 'user', content: text }],
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error(`请求错误 ${response.status}`);
      }

      const result = await response.json();
      const reply = result?.choices?.[0]?.message?.content ?? '没有返回内容';
      appendMessage(reply, 'ai');
    } catch (error: any) {
      console.error('[悬浮窗测试] 发送消息失败', error);
      appendMessage(`请求出错：${error?.message || String(error)}`, 'ai');
    }
  }

  sendMsgBtn.addEventListener('click', sendMessage);
  // Enter 发送消息，Shift+Enter 换行
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // =========================================================
  // 5) 参考 “全息悬浮终端” 的交互：球体拖拽、面板拖拽、开关控制
  //    这里保持了拖动边界处理，并保留脚本按钮显隐功能。
  // =========================================================
  function keepInBounds(element: HTMLElement, isFloatBall: boolean) {
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    let left = parseFloat(element.style.left) || 0;
    let top = parseFloat(element.style.top) || 0;

    const maxLeft = targetWindow.innerWidth - width - CONFIG.SAFE_MARGIN;
    const maxTop = targetWindow.innerHeight - (isFloatBall ? height : 60) - CONFIG.SAFE_MARGIN;

    element.style.left = `${Math.max(CONFIG.SAFE_MARGIN, Math.min(left, maxLeft))}px`;
    element.style.top = `${Math.max(CONFIG.SAFE_MARGIN, Math.min(top, maxTop))}px`;
  }

  targetWindow.addEventListener('resize', () => {
    if (panel.classList.contains('show')) {
      keepInBounds(panel, false);
    } else {
      keepInBounds(ball, true);
    }
  });

  function makeInteractive(element: HTMLElement, dragHandle: HTMLElement, isFloatBall: boolean, onClick?: () => void) {
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let isMoving = false;
    let animFrame: number | null = null;

    const onStart = (event: MouseEvent | TouchEvent) => {
      const pointer = event.type.includes('mouse') ? (event as MouseEvent) : (event as TouchEvent).touches[0];
      startX = pointer.clientX;
      startY = pointer.clientY;

      const rect = element.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      isMoving = false;

      targetDocument.addEventListener('mousemove', onMove, { passive: false });
      targetDocument.addEventListener('touchmove', onMove, { passive: false });
      targetDocument.addEventListener('mouseup', onEnd);
      targetDocument.addEventListener('touchend', onEnd);
    };

    const onMove = (event: MouseEvent | TouchEvent) => {
      const pointer = event.type.includes('mouse') ? (event as MouseEvent) : (event as TouchEvent).touches[0];
      const dx = pointer.clientX - startX;
      const dy = pointer.clientY - startY;

      if (!isMoving) {
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          isMoving = true;
          element.classList.add('dragging');
        } else {
          return;
        }
      }

      event.preventDefault();
      if (animFrame !== null) cancelAnimationFrame(animFrame);

      animFrame = requestAnimationFrame(() => {
        element.style.left = `${initialLeft + dx}px`;
        element.style.top = `${initialTop + dy}px`;
        if (isFloatBall) {
          // 拖拽过程中实时让歌词气泡跟随悬浮球
          positionLyricBubble();
        }
      });
    };

    const onEnd = () => {
      targetDocument.removeEventListener('mousemove', onMove);
      targetDocument.removeEventListener('touchmove', onMove);
      targetDocument.removeEventListener('mouseup', onEnd);
      targetDocument.removeEventListener('touchend', onEnd);
      if (animFrame !== null) cancelAnimationFrame(animFrame);

      if (isMoving) {
        element.classList.remove('dragging');
        keepInBounds(element, isFloatBall);
        // 悬浮球拖动结束后，立即让歌词气泡跟随新位置，避免延迟
        if (isFloatBall) positionLyricBubble();
      } else if (onClick) {
        onClick();
      }
      isMoving = false;
    };

    dragHandle.addEventListener('mousedown', onStart);
    dragHandle.addEventListener('touchstart', onStart, { passive: true });
  }

  function showPanel() {
    panel.classList.add('show');
    ball.classList.add('hidden');
    stopEmojiLoop();

    const ballRect = ball.getBoundingClientRect();
    const horizontalLeft = Math.max(
      CONFIG.SAFE_MARGIN,
      Math.min(ballRect.left - (CONFIG.PANEL_WIDTH / 2) + CONFIG.BALL_SIZE / 2, targetWindow.innerWidth - CONFIG.PANEL_WIDTH - CONFIG.SAFE_MARGIN),
    );
    const verticalTop = Math.max(
      CONFIG.SAFE_MARGIN,
      Math.min(ballRect.top - 100, targetWindow.innerHeight - CONFIG.PANEL_HEIGHT - CONFIG.SAFE_MARGIN),
    );

    panel.style.left = `${horizontalLeft}px`;
    panel.style.top = `${verticalTop}px`;
  }

  function hidePanel() {
    panel.classList.remove('show');
    ball.classList.remove('hidden');
    keepInBounds(ball, true);
    startEmojiLoop();
  }

  // =========================================================
  // 5.5) 悬浮球 emoji 气泡：面板关闭（显示球形图标）时，
  //      每隔一分钟从球上方弹出一个随机 emoji 气泡，2 秒后消失。
  // =========================================================
  let emojiTimer: number | null = null;

  function spawnEmojiPop() {
    // 动画关闭时悬浮球静止，不冒 emoji
    if (!ballAnimEnabled) return;
    // 播放歌曲时悬浮球不再冒 emoji
    if (!musicAudio.paused && musicAudio.src) return;
    const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    const pop = targetDocument.createElement('div');
    pop.className = 'emoji-pop';
    pop.textContent = emoji;

    // 定位在悬浮球正上方居中（ball 的相对位置即 holder 的绝对位置）
    const ballLeft = parseFloat(ball.style.left) || 0;
    const ballTop = parseFloat(ball.style.top) || 0;
    pop.style.left = `${ballLeft + CONFIG.BALL_SIZE / 2}px`;
    pop.style.top = `${ballTop}px`;
    shadow.appendChild(pop);

    // 2 秒后移除
    setTimeout(() => pop.remove(), 2000);
  }

  function startEmojiLoop() {
    stopEmojiLoop();
    spawnEmojiPop();
    emojiTimer = window.setInterval(spawnEmojiPop, 60000);
  }

  function stopEmojiLoop() {
    if (emojiTimer !== null) {
      window.clearInterval(emojiTimer);
      emojiTimer = null;
    }
  }

  closeBtn.onclick = hidePanel;
  makeInteractive(ball, ball, true, showPanel);
  makeInteractive(panel, header, false);
  startEmojiLoop();

  // =========================================================
  // 6) 酒馆脚本按钮集成：参考全息悬浮终端的自定义按钮控制
  //    允许在酒馆脚本栏快速隐藏或显示整个悬浮球，方便你后续接入其他功能。
  // =========================================================
  if (typeof appendInexistentScriptButtons === 'function') {
    appendInexistentScriptButtons([{ name: '显隐悬浮球', visible: true }]);
  }

  if (typeof eventOn === 'function' && typeof getButtonEvent === 'function') {
    let isUIVisible = true;
    eventOn(getButtonEvent('显隐悬浮球'), () => {
      isUIVisible = !isUIVisible;
      if (isUIVisible) {
        ball.classList.remove('force-hide');
        panel.classList.remove('force-hide');
        if (!panel.classList.contains('show')) startEmojiLoop();
      } else {
        ball.classList.add('force-hide');
        panel.classList.add('force-hide');
        panel.classList.remove('show');
        ball.classList.remove('hidden');
        stopEmojiLoop();
      }
    });
  }

  // =========================================================
  // 7) 参考全息脚本的页面隐藏回收逻辑：在离开页面时清理节点，避免残留。
  // =========================================================
  $(targetWindow).on('pagehide', () => {
    const oldWidget = targetDocument.getElementById(WIDGET_ID);
    if (oldWidget) oldWidget.remove();
  });

  // 默认打开桌面页，保持功能和新文件22 一致。
  showPage('desktop');
});
