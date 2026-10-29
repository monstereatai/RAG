import type { ProductionLowCodeSchema } from './production-workflow.state';

export interface PlaywayPreview {
  title: string;
  html: string;
  componentTypes: string[];
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/**
 * Render a safe, deterministic activity preview from pageSchema. It is deliberately
 * a preview renderer, not an assertion that an external low-code platform contract exists.
 */
export function renderPlaywayPreview(
  schemas: ProductionLowCodeSchema[],
  title = 'Playway 活动预览',
  activityContext = '',
): PlaywayPreview {
  // 多岗位可能各自产出 pageSchema。产品岗位的审查结果有时会保留一个
  // 空 schema，不能让它遮蔽设计／前端岗位已经生成的有效页面结构。
  const page =
    schemas.find(
      (schema) =>
        schema.kind === 'pageSchema' && (schema.components?.length ?? 0) > 0,
    ) ?? schemas.find((schema) => schema.kind === 'pageSchema');
  const components = page?.components ?? [];
  const context = `${title} ${activityContext}`;
  const isLottery = /抽奖|转盘|现金奖励|奖品/.test(context);
  const inferredComponents = isLottery
    ? ['wheel', 'prize-list', 'countdown', 'result-modal']
    : [];
  const componentTypes = [
    ...new Set([
      ...components
        .map((component) =>
          typeof component.type === 'string' ? component.type : '',
        )
        .filter(Boolean),
      ...inferredComponents,
    ]),
  ];
  const cards = components
    .map((component) => {
      const type =
        typeof component.type === 'string' ? component.type : 'unknown';
      const name = typeof component.name === 'string' ? component.name : type;
      return `<article class="component component-${escapeHtml(type)}"><span class="type">${escapeHtml(type)}</span><h2>${escapeHtml(name)}</h2><p>由 Playway Schema 生成的可交互占位组件</p></article>`;
    })
    .join('');
  const lotterySection = isLottery
    ? `<section class="activity-card lottery"><div class="section-heading"><span class="eyebrow">PLAYWAY LOTTERY</span><h2>幸运抽奖转盘</h2><p>五级现金奖励，点击按钮开始抽奖</p></div><div class="lottery-body"><div class="wheel-wrap"><div id="wheel" class="wheel"><span>100 元</span><span>50 元</span><span>20 元</span><span>10 元</span><span>2 元</span></div><div class="wheel-pointer">▼</div><button id="spin-button" class="spin" type="button" onclick="spin()">立即抽奖</button></div><div class="prizes"><h3>奖品列表</h3><div class="prize"><b>100 元</b><span>剩余 10 份</span></div><div class="prize"><b>50 元</b><span>剩余 10 份</span></div><div class="prize"><b>20 元</b><span>剩余 10 份</span></div><div class="prize"><b>10 元</b><span>剩余 10 份</span></div><div class="prize"><b>2 元</b><span>剩余 10 份</span></div></div></div><div id="result" class="result" style="display:none" aria-live="polite"></div></section>`
    : '';
  const rulesSection = `<section class="activity-card rules"><div class="section-heading"><span class="eyebrow">ACTIVITY RULES</span><h2>活动规则</h2></div><ul><li>活动期间每位用户仅可参与符合资格的活动次数。</li><li>奖品库存以服务端实时结果为准，中奖后按活动配置发放。</li><li>如遇网络异常，请稍后重试，最终结果以服务端记录为准。</li></ul></section>`;
  const safeTitle = escapeHtml(title);
  return {
    title,
    componentTypes,
    html: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>body{margin:0;background:#f5f7fb;color:#182230;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{max-width:820px;margin:0 auto;padding:28px 18px 64px}.hero{padding:32px 24px;margin-bottom:16px;border-radius:20px;background:linear-gradient(135deg,#1e3a8a,#7c3aed);color:#fff}.hero h1{margin:0 0 8px;font-size:28px}.hero p{margin:0;opacity:.82}.activity-card{padding:22px;margin:14px 0;border:1px solid #e4e9f2;border-radius:18px;background:#fff;box-shadow:0 8px 24px rgba(30,58,138,.06)}.section-heading h2{margin:5px 0 6px}.section-heading p,.rules li{color:#657187;font-size:14px}.eyebrow{color:#635bff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em}.lottery-body{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:center}.wheel-wrap{text-align:center;position:relative}.wheel{width:210px;height:210px;margin:8px auto 18px;border-radius:50%;border:10px solid #fff;outline:8px solid #ede9fe;background:conic-gradient(#f97316 0 20%,#facc15 20% 40%,#4ade80 40% 60%,#60a5fa 60% 80%,#c084fc 80% 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 12px 30px #312e8133;transition:transform 1.6s cubic-bezier(.16,1,.3,1)}.wheel.spinning{transform:rotate(1440deg)}.wheel span{position:absolute;font-weight:700;color:#fff;text-shadow:0 1px 2px #0008}.wheel span:nth-child(1){transform:translateY(-72px)}.wheel span:nth-child(2){transform:translate(68px,-22px)}.wheel span:nth-child(3){transform:translate(42px,58px)}.wheel span:nth-child(4){transform:translate(-42px,58px)}.wheel span:nth-child(5){transform:translate(-68px,-22px)}.wheel-pointer{color:#ef4444;font-size:24px;margin-top:-28px;position:relative;z-index:2}.spin{border:0;border-radius:999px;padding:12px 28px;background:#4f46e5;color:#fff;font-weight:700;cursor:pointer}.spin:disabled{opacity:.6;cursor:wait}.prizes h3{margin-top:0}.prize{display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid #eef1f6}.prize span{color:#94a3b8;font-size:13px}.result{margin-top:16px;padding:14px;border-radius:12px;background:#eef2ff;color:#3730a3}.rules ul{padding-left:20px;line-height:1.9}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.component{min-height:100px;padding:18px;border:1px solid #e4e9f2;border-radius:16px;background:#fff}.component h2{margin:12px 0 8px;font-size:17px}.component p{margin:0;color:#657187;font-size:13px}.type{color:#635bff;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:640px){.lottery-body{grid-template-columns:1fr}}</style></head><body><main class="shell"><header class="hero"><h1>${safeTitle}</h1><p>由 Playway pageSchema 生成的活动页结构预览，共 ${componentTypes.length} 个组件</p></header>${lotterySection}${isLottery ? rulesSection : ''}<section class="grid">${cards || '<article class="component"><h2>暂无页面组件</h2><p>请先生成 pageSchema。</p></article>'}</section></main><script>function spin(){const wheel=document.getElementById('wheel');const button=document.getElementById('spin-button');const el=document.getElementById('result');if(!wheel||!button||!el||button.disabled)return;button.disabled=true;el.style.display='none';wheel.classList.remove('spinning');void wheel.offsetWidth;wheel.classList.add('spinning');window.setTimeout(function(){el.style.display='block';el.textContent='抽奖结果：恭喜你获得 20 元现金奖励（预览模拟结果）';button.disabled=false;},1600);}</script></body></html>`,
  };
}
